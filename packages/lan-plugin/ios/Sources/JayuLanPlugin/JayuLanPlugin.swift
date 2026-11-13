import Foundation
import Capacitor
import Network
import UIKit

private let kServiceType = "_jayubrawl._udp"
private let kDefaultPort = 47820
private let kMaxDatagram = 16 * 1024
private let kHostPeerId = "host"
private let kProbePrefix = "JayuLanProbe-"
private let kMaxHostPeers = 64
/// kDNSServiceErr_PolicyDenied: Local Network access is denied (or not yet granted).
private let kPolicyDeniedCode: Int32 = -65570
private let kErrorThrottleNanos: UInt64 = 1_000_000_000

/// Raw UDP datagrams + Bonjour discovery for Jayu LAN matches, built on Network.framework.
///
/// All Network.framework objects are started on `lanQueue`, so every handler runs there and
/// every stored property below is only read or written on that queue.
@objc(JayuLanPlugin)
public class JayuLanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JayuLanPlugin"
    public let jsName = "JayuLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startHost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopHost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendBatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLocalAddresses", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkLocalNetwork", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private let lanQueue = DispatchQueue(label: "com.jayu.lan", qos: .userInitiated)

    // ---- only touched on lanQueue ----
    private var hostListener: NWListener?
    /// "ip:port" -> the per-remote connection NWListener created for that peer.
    private var hostPeers: [String: NWConnection] = [:]
    private var clientConnection: NWConnection?
    private var discoveryBrowser: NWBrowser?
    /// Bonjour instance name -> short-lived connection used to resolve it to IPv4 host/port.
    private var resolvers: [String: NWConnection] = [:]
    private var lastErrorAt: [String: UInt64] = [:]

    deinit {
        hostListener?.cancel()
        for (_, connection) in hostPeers { connection.cancel() }
        clientConnection?.cancel()
        discoveryBrowser?.cancel()
        for (_, connection) in resolvers { connection.cancel() }
    }

    // MARK: - Host

    @objc func startHost(_ call: CAPPluginCall) {
        guard let serviceName = call.getString("serviceName"), !serviceName.isEmpty else {
            call.reject("serviceName is required", "INVALID_ARGUMENT")
            return
        }
        let port = call.getInt("port") ?? kDefaultPort
        guard port >= 0, port <= 65535 else {
            call.reject("port must be between 0 and 65535", "INVALID_ARGUMENT")
            return
        }
        let txt = JayuLanPlugin.txtRecordData(JayuLanPlugin.stringMap(call.getObject("meta")))
        lanQueue.async {
            self.stopHostOnQueue()
            self.startListener(port: port, serviceName: serviceName, txt: txt, call: call, allowFallback: port != 0)
        }
    }

    @objc func stopHost(_ call: CAPPluginCall) {
        lanQueue.async {
            self.stopHostOnQueue()
            call.resolve()
        }
    }

    private func startListener(port: Int, serviceName: String, txt: Data, call: CAPPluginCall, allowFallback: Bool) {
        let params = NWParameters.udp
        params.includePeerToPeer = false

        var nwPort = NWEndpoint.Port.any
        if port != 0 {
            guard let requested = NWEndpoint.Port(rawValue: UInt16(port)) else {
                call.reject("Invalid port", "INVALID_ARGUMENT")
                return
            }
            nwPort = requested
        }

        let listener: NWListener
        do {
            listener = try NWListener(using: params, on: nwPort)
        } catch {
            if allowFallback {
                startListener(port: 0, serviceName: serviceName, txt: txt, call: call, allowFallback: false)
            } else {
                call.reject("Could not open UDP listener: \(error.localizedDescription)", "BIND_FAILED")
            }
            return
        }

        listener.service = NWListener.Service(name: serviceName, type: kServiceType, domain: nil, txtRecord: txt)
        hostListener = listener
        var settled = false

        listener.newConnectionHandler = { [weak self] connection in
            guard let self = self else {
                connection.cancel()
                return
            }
            self.acceptPeer(connection)
        }

        // The handler holds the listener strongly; the cycle is broken on .cancelled.
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if !settled {
                    settled = true
                    let boundPort = Int(listener.port?.rawValue ?? 0)
                    call.resolve(["port": boundPort, "addresses": JayuLanPlugin.localIPv4Addresses()])
                }
            case .waiting(let error):
                if JayuLanPlugin.isPolicyDenied(error) {
                    self?.emitError("Local network access is denied", code: "LOCAL_NETWORK_DENIED")
                }
            case .failed(let error):
                let wasCurrent = self?.hostListener === listener
                if wasCurrent { self?.hostListener = nil }
                listener.cancel()
                if !settled {
                    settled = true
                    if allowFallback && wasCurrent, let self = self {
                        // Most likely EADDRINUSE: fall back to an ephemeral port.
                        self.startListener(port: 0, serviceName: serviceName, txt: txt, call: call, allowFallback: false)
                    } else {
                        call.reject("UDP listener failed: \(error.localizedDescription)", "BIND_FAILED")
                    }
                } else if wasCurrent {
                    self?.emitError("Host socket failed: \(error.localizedDescription)", code: "HOST_FAILED")
                }
            case .cancelled:
                listener.stateUpdateHandler = nil
                listener.newConnectionHandler = nil
                if !settled {
                    settled = true
                    call.reject("Host was stopped before it was ready", "CANCELLED")
                }
            default:
                break
            }
        }

        listener.start(queue: lanQueue)

        lanQueue.asyncAfter(deadline: .now() + 5.0) { [weak self] in
            if settled { return }
            settled = true
            if self?.hostListener === listener { self?.hostListener = nil }
            listener.cancel()
            call.reject("Timed out opening the UDP listener", "HOST_TIMEOUT")
        }
    }

    private func acceptPeer(_ connection: NWConnection) {
        guard hostListener != nil, let peerId = JayuLanPlugin.peerId(for: connection.endpoint) else {
            connection.cancel()
            return
        }
        if let existing = hostPeers[peerId] {
            if existing === connection { return }
            existing.cancel()
            hostPeers.removeValue(forKey: peerId)
        }
        guard hostPeers.count < kMaxHostPeers else {
            connection.cancel()
            return
        }
        hostPeers[peerId] = connection
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self = self, let connection = connection else { return }
            switch state {
            case .failed(_), .cancelled:
                if self.hostPeers[peerId] === connection {
                    self.hostPeers.removeValue(forKey: peerId)
                }
            default:
                break
            }
        }
        connection.start(queue: lanQueue)
        receiveLoop(connection, peerId: peerId)
    }

    private func stopHostOnQueue() {
        if let listener = hostListener {
            hostListener = nil
            listener.cancel()
        }
        let peers = hostPeers
        hostPeers.removeAll()
        for (_, connection) in peers { connection.cancel() }
    }

    // MARK: - Client

    @objc func connect(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), !host.isEmpty else {
            call.reject("host is required", "INVALID_ARGUMENT")
            return
        }
        guard let port = call.getInt("port"), port > 0, port <= 65535,
              let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            call.reject("port must be between 1 and 65535", "INVALID_ARGUMENT")
            return
        }
        lanQueue.async {
            self.disconnectOnQueue()
            let params = NWParameters.udp
            params.includePeerToPeer = false
            let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: params)
            self.clientConnection = connection
            var settled = false
            var policyDenied = false

            // The handler holds the connection strongly; the cycle is broken on .cancelled.
            connection.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    policyDenied = false
                    if !settled {
                        settled = true
                        call.resolve()
                    }
                case .waiting(let error):
                    if JayuLanPlugin.isPolicyDenied(error) {
                        policyDenied = true
                        if settled {
                            self?.emitError("Local network access is denied", code: "LOCAL_NETWORK_DENIED")
                        }
                    }
                case .failed(let error):
                    if self?.clientConnection === connection { self?.clientConnection = nil }
                    connection.cancel()
                    if !settled {
                        settled = true
                        call.reject("Connection failed: \(error.localizedDescription)", "CONNECT_FAILED")
                    } else {
                        self?.emitError("Connection failed: \(error.localizedDescription)", code: "CONNECTION_FAILED")
                    }
                case .cancelled:
                    connection.stateUpdateHandler = nil
                    if !settled {
                        settled = true
                        call.reject("Disconnected before the connection was ready", "CANCELLED")
                    }
                default:
                    break
                }
            }

            self.receiveLoop(connection, peerId: kHostPeerId)
            connection.start(queue: self.lanQueue)

            // UDP has no handshake; if the path is still preparing after a moment, resolve anyway
            // (sends are queued by NWConnection) unless Local Network access is denied.
            self.lanQueue.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                if settled { return }
                settled = true
                if policyDenied {
                    if self?.clientConnection === connection { self?.clientConnection = nil }
                    connection.cancel()
                    call.reject("Local network access is denied", "LOCAL_NETWORK_DENIED")
                } else {
                    call.resolve()
                }
            }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        lanQueue.async {
            self.disconnectOnQueue()
            call.resolve()
        }
    }

    private func disconnectOnQueue() {
        if let connection = clientConnection {
            clientConnection = nil
            connection.cancel()
        }
    }

    // MARK: - Datagrams

    private func receiveLoop(_ connection: NWConnection, peerId: String) {
        connection.receiveMessage { [weak self, weak connection] data, _, _, error in
            guard let self = self, let connection = connection else { return }
            if let data = data, data.count <= kMaxDatagram {
                self.notifyListeners("message", data: ["peerId": peerId, "data": data.base64EncodedString()])
            }
            switch connection.state {
            case .cancelled, .failed(_):
                return
            default:
                break
            }
            if let error = error {
                if case .posix(let code) = error, code == .ECANCELED { return }
                self.emitError("Receive failed: \(error.localizedDescription)", code: "RECEIVE_FAILED")
                self.lanQueue.asyncAfter(deadline: .now() + 0.05) { [weak self, weak connection] in
                    guard let self = self, let connection = connection else { return }
                    self.receiveLoop(connection, peerId: peerId)
                }
                return
            }
            self.receiveLoop(connection, peerId: peerId)
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId"), let data = call.getString("data") else {
            call.reject("peerId and data are required", "INVALID_ARGUMENT")
            return
        }
        lanQueue.async {
            guard let connection = self.connection(for: peerId) else {
                call.reject("No open socket for peer \(peerId)", "NOT_CONNECTED")
                return
            }
            self.sendDatagram(data, on: connection)
            call.resolve()
        }
    }

    @objc func sendBatch(_ call: CAPPluginCall) {
        guard let messages = call.getArray("messages") else {
            call.reject("messages is required", "INVALID_ARGUMENT")
            return
        }
        var items: [(peerId: String, data: String)] = []
        items.reserveCapacity(messages.count)
        for message in messages {
            guard let obj = message as? JSObject,
                  let peerId = obj["peerId"] as? String,
                  let data = obj["data"] as? String else { continue }
            items.append((peerId: peerId, data: data))
        }
        lanQueue.async {
            // Group per peer (keeping per-peer order) so each connection gets one batched flush.
            var order: [String] = []
            var groups: [String: [String]] = [:]
            for item in items {
                if groups[item.peerId] == nil {
                    order.append(item.peerId)
                    groups[item.peerId] = []
                }
                groups[item.peerId]?.append(item.data)
            }
            for peerId in order {
                guard let connection = self.connection(for: peerId), let payloads = groups[peerId] else { continue }
                connection.batch {
                    for payload in payloads {
                        self.sendDatagram(payload, on: connection)
                    }
                }
            }
            call.resolve()
        }
    }

    /// Client: "host" is the connected remote. Host: "ip:port" of a peer that has sent to us.
    private func connection(for peerId: String) -> NWConnection? {
        if peerId == kHostPeerId, let client = clientConnection {
            return client
        }
        return hostPeers[peerId]
    }

    private func sendDatagram(_ base64: String, on connection: NWConnection) {
        switch connection.state {
        case .cancelled, .failed(_):
            return
        default:
            break
        }
        guard let payload = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            emitError("Invalid base64 payload", code: "INVALID_DATA")
            return
        }
        guard payload.count <= kMaxDatagram else {
            emitError("Datagram larger than 16 KB dropped (\(payload.count) bytes)", code: "TOO_LARGE")
            return
        }
        connection.send(content: payload, completion: .contentProcessed({ [weak self] error in
            guard let error = error else { return }
            if case .posix(let code) = error, code == .ECANCELED { return }
            self?.emitError("Send failed: \(error.localizedDescription)", code: "SEND_FAILED")
        }))
    }

    // MARK: - Discovery

    @objc func startDiscovery(_ call: CAPPluginCall) {
        lanQueue.async {
            self.stopDiscoveryOnQueue()
            let params = NWParameters()
            params.includePeerToPeer = false
            let browser = NWBrowser(for: .bonjourWithTXTRecord(type: kServiceType, domain: nil), using: params)
            self.discoveryBrowser = browser

            browser.stateUpdateHandler = { [weak self, weak browser] state in
                guard let self = self, let browser = browser, self.discoveryBrowser === browser else { return }
                switch state {
                case .waiting(let error):
                    if JayuLanPlugin.isPolicyDenied(error) {
                        self.emitError("Local network access is denied", code: "LOCAL_NETWORK_DENIED")
                    } else {
                        self.emitError("Discovery is waiting: \(error.localizedDescription)", code: "DISCOVERY_WAITING")
                    }
                case .failed(let error):
                    self.discoveryBrowser = nil
                    browser.cancel()
                    self.emitError("Discovery failed: \(error.localizedDescription)", code: "DISCOVERY_FAILED")
                default:
                    break
                }
            }

            browser.browseResultsChangedHandler = { [weak self, weak browser] _, changes in
                guard let self = self, let browser = browser, self.discoveryBrowser === browser else { return }
                for change in changes {
                    switch change {
                    case .added(let result):
                        self.resolveResult(result)
                    case .removed(let result):
                        self.handleLost(result)
                    case .changed(old: _, new: let result, flags: _):
                        // TXT (player count etc.) changed: re-resolve and re-emit serviceFound.
                        self.resolveResult(result)
                    case .identical:
                        break
                    @unknown default:
                        break
                    }
                }
            }

            browser.start(queue: self.lanQueue)
            call.resolve()
        }
    }

    @objc func stopDiscovery(_ call: CAPPluginCall) {
        lanQueue.async {
            self.stopDiscoveryOnQueue()
            call.resolve()
        }
    }

    private func stopDiscoveryOnQueue() {
        if let browser = discoveryBrowser {
            discoveryBrowser = nil
            browser.cancel()
        }
        let pending = resolvers
        resolvers.removeAll()
        for (_, connection) in pending { connection.cancel() }
    }

    /// Resolves a Bonjour result to an IPv4 host/port by opening a short-lived UDP NWConnection
    /// (restricted to IPv4) to the service endpoint and reading the resolved remote endpoint.
    /// UDP has no handshake, so nothing is sent to the host.
    private func resolveResult(_ result: NWBrowser.Result) {
        guard case let .service(name, _, _, _) = result.endpoint else { return }
        if name.hasPrefix(kProbePrefix) { return }
        var meta: [String: String] = [:]
        if case let .bonjour(txt) = result.metadata {
            meta = txt.dictionary
        }

        resolvers[name]?.cancel()
        let params = NWParameters.udp
        params.includePeerToPeer = false
        if let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let connection = NWConnection(to: result.endpoint, using: params)
        resolvers[name] = connection

        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self = self, let connection = connection else { return }
            switch state {
            case .ready:
                if self.discoveryBrowser != nil,
                   let remote = connection.currentPath?.remoteEndpoint,
                   case let .hostPort(host, port) = remote {
                    self.notifyListeners("serviceFound", data: [
                        "name": name,
                        "host": JayuLanPlugin.hostString(host),
                        "port": Int(port.rawValue),
                        "meta": meta
                    ])
                }
                self.finishResolver(name, connection)
            case .waiting(let error):
                if JayuLanPlugin.isPolicyDenied(error) {
                    self.emitError("Local network access is denied", code: "LOCAL_NETWORK_DENIED")
                    self.finishResolver(name, connection)
                }
            case .failed(_):
                self.finishResolver(name, connection)
            default:
                break
            }
        }
        connection.start(queue: lanQueue)

        lanQueue.asyncAfter(deadline: .now() + 5.0) { [weak self, weak connection] in
            guard let self = self, let connection = connection else { return }
            self.finishResolver(name, connection)
        }
    }

    private func finishResolver(_ name: String, _ connection: NWConnection) {
        if resolvers[name] === connection {
            resolvers.removeValue(forKey: name)
        }
        connection.cancel()
    }

    private func handleLost(_ result: NWBrowser.Result) {
        guard case let .service(name, _, _, _) = result.endpoint else { return }
        if name.hasPrefix(kProbePrefix) { return }
        if let pending = resolvers.removeValue(forKey: name) {
            pending.cancel()
        }
        notifyListeners("serviceLost", data: ["name": name])
    }

    // MARK: - Local Network permission

    /// There is no API for the Local Network permission. We advertise a throwaway Bonjour
    /// service and browse for our service type: any browse result means access works
    /// ("granted"); a PolicyDenied DNS error means "denied". Doing this is also what makes
    /// iOS show the permission prompt on first use.
    @objc func checkLocalNetwork(_ call: CAPPluginCall) {
        lanQueue.async {
            self.runLocalNetworkProbe(call)
        }
    }

    private func runLocalNetworkProbe(_ call: CAPPluginCall) {
        let probeName = kProbePrefix + String(UUID().uuidString.prefix(8))
        let params = NWParameters()
        params.includePeerToPeer = false
        let browser = NWBrowser(for: .bonjour(type: kServiceType, domain: nil), using: params)
        var listener: NWListener? = try? NWListener(using: .udp)
        var finished = false
        var policyDenied = false
        var browserReady = false

        // Captures browser/listener strongly; clearing the handlers here breaks the cycles.
        let finish: (String) -> Void = { status in
            if finished { return }
            finished = true
            browser.stateUpdateHandler = nil
            browser.browseResultsChangedHandler = nil
            browser.cancel()
            if let probe = listener {
                probe.stateUpdateHandler = nil
                probe.cancel()
            }
            listener = nil
            call.resolve(["status": status])
        }

        if let probe = listener {
            probe.service = NWListener.Service(name: probeName, type: kServiceType)
            probe.newConnectionHandler = { connection in connection.cancel() }
            probe.stateUpdateHandler = { state in
                switch state {
                case .waiting(let error), .failed(let error):
                    if JayuLanPlugin.isPolicyDenied(error) { policyDenied = true }
                default:
                    break
                }
            }
            probe.start(queue: lanQueue)
        }

        browser.stateUpdateHandler = { state in
            switch state {
            case .ready:
                browserReady = true
            case .waiting(let error):
                if JayuLanPlugin.isPolicyDenied(error) { policyDenied = true }
            case .failed(let error):
                finish(JayuLanPlugin.isPolicyDenied(error) ? "denied" : "unknown")
            default:
                break
            }
        }
        browser.browseResultsChangedHandler = { results, _ in
            if !results.isEmpty { finish("granted") }
        }
        browser.start(queue: lanQueue)

        lanQueue.asyncAfter(deadline: .now() + 2.0) {
            if policyDenied {
                finish("denied")
            } else if browserReady {
                // Browsing works but we never saw even our own probe: the prompt is most
                // likely still on screen (or the answer is not known yet).
                finish("prompt")
            } else {
                finish("unknown")
            }
        }
    }

    // MARK: - Misc

    @objc func getLocalAddresses(_ call: CAPPluginCall) {
        call.resolve(["addresses": JayuLanPlugin.localIPv4Addresses()])
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Settings URL is unavailable", "UNAVAILABLE")
                return
            }
            UIApplication.shared.open(url, options: [:]) { success in
                if success {
                    call.resolve()
                } else {
                    call.reject("Could not open Settings", "UNAVAILABLE")
                }
            }
        }
    }

    /// Must be called on lanQueue. At most one event per second per code.
    private func emitError(_ message: String, code: String) {
        let now = DispatchTime.now().uptimeNanoseconds
        if let last = lastErrorAt[code], now >= last, now - last < kErrorThrottleNanos {
            return
        }
        lastErrorAt[code] = now
        notifyListeners("error", data: ["message": message, "code": code])
    }

    // MARK: - Helpers

    private static func isPolicyDenied(_ error: NWError) -> Bool {
        if case let .dns(code) = error {
            return code == kPolicyDeniedCode
        }
        return false
    }

    private static func peerId(for endpoint: NWEndpoint) -> String? {
        if case let .hostPort(host, port) = endpoint {
            return "\(hostString(host)):\(port.rawValue)"
        }
        return nil
    }

    private static func hostString(_ host: NWEndpoint.Host) -> String {
        switch host {
        case .ipv4(let address):
            return ipv4String(address)
        case .ipv6(let address):
            if let mapped = address.asIPv4 {
                return ipv4String(mapped)
            }
            return ipv6String(address)
        case .name(let name, _):
            return name
        @unknown default:
            return "\(host)"
        }
    }

    private static func ipv4String(_ address: IPv4Address) -> String {
        let bytes = [UInt8](address.rawValue)
        guard bytes.count == 4 else { return "\(address)" }
        return "\(bytes[0]).\(bytes[1]).\(bytes[2]).\(bytes[3])"
    }

    private static func ipv6String(_ address: IPv6Address) -> String {
        var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
        let size = socklen_t(buffer.count)
        let ok: Bool = address.rawValue.withUnsafeBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return false }
            return inet_ntop(AF_INET6, base, &buffer, size) != nil
        }
        guard ok else { return "\(address)" }
        let bytes = buffer.prefix(while: { $0 != 0 }).map { UInt8(bitPattern: $0) }
        return String(decoding: bytes, as: UTF8.self)
    }

    /// Non-loopback IPv4 addresses of up interfaces. Wi-Fi (en*) and the Personal Hotspot
    /// bridge (bridge*) come first; cellular and VPN tunnels are skipped.
    static func localIPv4Addresses() -> [String] {
        var preferred: [String] = []
        var others: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return [] }
        defer { freeifaddrs(ifaddr) }

        let excluded = ["pdp_ip", "utun", "ipsec", "awdl", "llw", "ppp", "gif", "stf"]
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let current = cursor {
            let entry = current.pointee
            cursor = entry.ifa_next

            let flags = entry.ifa_flags
            guard (flags & UInt32(IFF_UP)) != 0, (flags & UInt32(IFF_LOOPBACK)) == 0 else { continue }
            guard let sa = entry.ifa_addr, sa.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let name = String(cString: entry.ifa_name)
            if excluded.contains(where: { name.hasPrefix($0) }) { continue }

            let sin = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
            let bytes = withUnsafeBytes(of: sin.sin_addr) { Array($0) }
            guard bytes.count == 4, bytes[0] != 127 else { continue }
            let ip = "\(bytes[0]).\(bytes[1]).\(bytes[2]).\(bytes[3])"

            if name.hasPrefix("en") || name.hasPrefix("bridge") {
                if !preferred.contains(ip) { preferred.append(ip) }
            } else if !others.contains(ip) {
                others.append(ip)
            }
        }
        return preferred + others.filter { !preferred.contains($0) }
    }

    private static func stringMap(_ object: JSObject?) -> [String: String] {
        var out: [String: String] = [:]
        guard let object = object else { return out }
        for (key, value) in object {
            if let string = value as? String {
                out[key] = string
            } else if let number = value as? NSNumber {
                out[key] = number.stringValue
            }
        }
        return out
    }

    /// DNS-SD TXT wire format: a sequence of length-prefixed "key=value" strings (<= 255 bytes each).
    private static func txtRecordData(_ meta: [String: String]) -> Data {
        var out = Data()
        for key in meta.keys.sorted() {
            guard let value = meta[key], !key.isEmpty, !key.contains("=") else { continue }
            var entry = Data(key.utf8)
            entry.append(UInt8(ascii: "="))
            entry.append(contentsOf: Array(value.utf8))
            guard entry.count <= 255 else { continue }
            out.append(UInt8(entry.count))
            out.append(entry)
        }
        if out.isEmpty {
            out.append(UInt8(0))
        }
        return out
    }
}
