package com.jayu.lan

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.SocketException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Raw UDP datagrams + NSD (DNS-SD) discovery for Jayu LAN matches.
 *
 * Threading:
 *  - Plugin methods run on Capacitor's plugin thread; they never do socket I/O themselves.
 *  - Each open socket has its own daemon receive thread.
 *  - All outgoing datagrams go through one single-threaded send executor (keeps per-peer order).
 *  - NSD callbacks arrive on the main looper (or a binder thread); shared state is guarded by [stateLock].
 */
@CapacitorPlugin(name = "JayuLan")
class JayuLanPlugin : Plugin() {

    companion object {
        private const val SERVICE_TYPE = "_jayubrawl._udp"
        private const val DEFAULT_PORT = 47820
        private const val MAX_DATAGRAM = 16 * 1024
        private const val SOCKET_BUFFER_BYTES = 512 * 1024
        private const val HOST_PEER = "host"
        private const val PROBE_PREFIX = "JayuLanProbe-"
        private const val RESOLVE_TIMEOUT_MS = 6000L
        private const val RESOLVE_RETRY_MS = 400L
        private const val MAX_RESOLVE_ATTEMPTS = 5
        private const val MAX_PEER_CACHE = 1024
        private const val ERROR_THROTTLE_MS = 1000L

        /** Cellular / VPN / tunnel interfaces that are useless for LAN play. */
        private val EXCLUDED_IFACE_PREFIXES = listOf(
            "rmnet", "r_rmnet", "v4-", "ccmni", "pdp", "ppp", "tun", "ipsec", "clat", "dummy", "seth", "usb_rmnet"
        )

        /** Wi-Fi, hotspot (ap0 / swlan0 / wlan1 / softap) and ethernet first. */
        private val PREFERRED_IFACE_PREFIXES = listOf("wlan", "swlan", "ap", "softap", "eth", "rndis")
    }

    private class Outgoing(val socket: DatagramSocket, val address: InetSocketAddress, val data: String)

    private class ResolveJob(val info: NsdServiceInfo, val name: String) {
        var attempts = 0
    }

    private val stateLock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val sendExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "JayuLan-send").apply { isDaemon = true }
    }

    /** peerId ("ip:port") -> socket address, so sends don't re-parse strings. */
    private val peerCache = ConcurrentHashMap<String, InetSocketAddress>()
    private val lastErrorAt = ConcurrentHashMap<String, Long>()

    // ---- state guarded by stateLock ----
    private var hostSocket: DatagramSocket? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var clientSocket: DatagramSocket? = null
    private var clientRemote: InetSocketAddress? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val resolveQueue = ArrayDeque<ResolveJob>()
    private var resolving: ResolveJob? = null
    private var resolveToken = 0
    private var multicastLock: WifiManager.MulticastLock? = null

    private val nsdManager: NsdManager?
        get() = context?.getSystemService(Context.NSD_SERVICE) as? NsdManager

    // =====================================================================
    // Host
    // =====================================================================

    @PluginMethod
    fun startHost(call: PluginCall) {
        val serviceName: String? = call.getString("serviceName")
        if (serviceName.isNullOrBlank()) {
            call.reject("serviceName is required", "INVALID_ARGUMENT")
            return
        }
        val requestedPort: Int = call.getInt("port") ?: DEFAULT_PORT
        if (requestedPort < 0 || requestedPort > 65535) {
            call.reject("port must be between 0 and 65535", "INVALID_ARGUMENT")
            return
        }
        val meta: JSObject = call.getObject("meta") ?: JSObject()

        stopHostInternal()

        val socket = try {
            openHostSocket(requestedPort)
        } catch (e: Exception) {
            call.reject("Could not bind UDP socket: ${e.message}", "BIND_FAILED", e)
            return
        }
        synchronized(stateLock) { hostSocket = socket }
        startReceiveThread(socket, null, "JayuLan-host-rx")
        registerService(serviceName, socket.localPort, meta)
        updateMulticastLock()

        val ret = JSObject()
        ret.put("port", socket.localPort)
        ret.put("addresses", toJSArray(localIPv4Addresses()))
        call.resolve(ret)
    }

    @PluginMethod
    fun stopHost(call: PluginCall) {
        stopHostInternal()
        call.resolve()
    }

    private fun openHostSocket(port: Int): DatagramSocket {
        if (port != 0) {
            try {
                return configureSocket(DatagramSocket(port))
            } catch (ignored: SocketException) {
                // Port busy (another app / previous match still closing): use an ephemeral port.
            }
        }
        return configureSocket(DatagramSocket(0))
    }

    private fun configureSocket(socket: DatagramSocket): DatagramSocket {
        try {
            socket.receiveBufferSize = SOCKET_BUFFER_BYTES
        } catch (ignored: Exception) {
        }
        try {
            socket.sendBufferSize = SOCKET_BUFFER_BYTES
        } catch (ignored: Exception) {
        }
        return socket
    }

    private fun registerService(name: String, port: Int, meta: JSObject) {
        val nsd = nsdManager
        if (nsd == null) {
            emitError("Network service discovery is unavailable; the match will not be advertised", "ADVERTISE_FAILED")
            return
        }
        val info = NsdServiceInfo()
        info.serviceName = name
        info.serviceType = SERVICE_TYPE
        info.port = port
        val keys = meta.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = meta.opt(key)
            if (value == null || value == JSONObject.NULL) continue
            try {
                info.setAttribute(key, value.toString())
            } catch (e: IllegalArgumentException) {
                emitError("TXT record entry '$key' rejected: ${e.message}", "ADVERTISE_FAILED")
            }
        }

        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo?) {}

            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                val wasCurrent = synchronized(stateLock) {
                    if (registrationListener === this) {
                        registrationListener = null
                        true
                    } else {
                        false
                    }
                }
                if (wasCurrent) emitError("Service registration failed (code $errorCode)", "ADVERTISE_FAILED")
            }

            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo?) {}

            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {}
        }

        synchronized(stateLock) { registrationListener = listener }
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            synchronized(stateLock) {
                if (registrationListener === listener) registrationListener = null
            }
            emitError("Service registration failed: ${e.message}", "ADVERTISE_FAILED")
        }
    }

    private fun stopHostInternal() {
        val (socket, listener) = synchronized(stateLock) {
            val s = hostSocket
            val l = registrationListener
            hostSocket = null
            registrationListener = null
            Pair(s, l)
        }
        if (listener != null) {
            try {
                nsdManager?.unregisterService(listener)
            } catch (ignored: Exception) {
            }
        }
        socket?.close()
        peerCache.clear()
        updateMulticastLock()
    }

    // =====================================================================
    // Discovery
    // =====================================================================

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        val nsd = nsdManager
        if (nsd == null) {
            call.reject("Network service discovery is unavailable", "UNAVAILABLE")
            return
        }
        stopDiscoveryInternal()
        val listener = createDiscoveryListener()
        synchronized(stateLock) { discoveryListener = listener }
        updateMulticastLock()
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            synchronized(stateLock) {
                if (discoveryListener === listener) discoveryListener = null
            }
            updateMulticastLock()
            call.reject("Could not start discovery: ${e.message}", "DISCOVERY_FAILED", e)
            return
        }
        call.resolve()
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        stopDiscoveryInternal()
        call.resolve()
    }

    private fun stopDiscoveryInternal() {
        val listener = synchronized(stateLock) {
            val l = discoveryListener
            discoveryListener = null
            resolveQueue.clear()
            resolving = null
            resolveToken += 1
            l
        }
        if (listener != null) {
            try {
                nsdManager?.stopServiceDiscovery(listener)
            } catch (ignored: Exception) {
            }
        }
        updateMulticastLock()
    }

    private fun createDiscoveryListener(): NsdManager.DiscoveryListener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String?) {}

        override fun onDiscoveryStopped(serviceType: String?) {}

        override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
            val wasCurrent = synchronized(stateLock) {
                if (discoveryListener === this) {
                    discoveryListener = null
                    true
                } else {
                    false
                }
            }
            if (wasCurrent) {
                updateMulticastLock()
                emitError("Service discovery failed to start (code $errorCode)", "DISCOVERY_FAILED")
            }
        }

        override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {}

        override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
            if (serviceInfo == null) return
            val raw = serviceInfo.serviceName ?: return
            val name = unescapeServiceName(raw)
            if (name.startsWith(PROBE_PREFIX)) return
            synchronized(stateLock) {
                if (discoveryListener !== this) return
                if (resolving?.name == name || resolveQueue.any { it.name == name }) return
                resolveQueue.addLast(ResolveJob(serviceInfo, name))
            }
            pumpResolve()
        }

        override fun onServiceLost(serviceInfo: NsdServiceInfo?) {
            if (serviceInfo == null) return
            val raw = serviceInfo.serviceName ?: return
            val name = unescapeServiceName(raw)
            if (name.startsWith(PROBE_PREFIX)) return
            synchronized(stateLock) {
                if (discoveryListener !== this) return
                resolveQueue.removeAll { it.name == name }
            }
            val ev = JSObject()
            ev.put("name", name)
            notifyListeners("serviceLost", ev)
        }
    }

    /** NsdManager (before API 34) only allows one resolve at a time, so resolves are queued. */
    private fun pumpResolve() {
        val next = synchronized(stateLock) {
            if (resolving != null || discoveryListener == null) {
                null
            } else {
                val job = resolveQueue.removeFirstOrNull()
                if (job == null) {
                    null
                } else {
                    resolving = job
                    resolveToken += 1
                    Pair(job, resolveToken)
                }
            }
        } ?: return
        startResolve(next.first, next.second)
    }

    @Suppress("DEPRECATION")
    private fun startResolve(job: ResolveJob, token: Int) {
        val nsd = nsdManager
        if (nsd == null) {
            finishResolve(token)
            return
        }
        // Watchdog: some devices occasionally never call back.
        mainHandler.postDelayed({ finishResolve(token) }, RESOLVE_TIMEOUT_MS)
        val listener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                if (errorCode == NsdManager.FAILURE_ALREADY_ACTIVE && job.attempts < MAX_RESOLVE_ATTEMPTS) {
                    mainHandler.postDelayed({ retryResolve(job, token) }, RESOLVE_RETRY_MS)
                } else {
                    finishResolve(token)
                }
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo?) {
                if (serviceInfo != null) emitServiceFound(job.name, serviceInfo)
                finishResolve(token)
            }
        }
        try {
            nsd.resolveService(job.info, listener)
        } catch (e: Exception) {
            finishResolve(token)
        }
    }

    private fun retryResolve(job: ResolveJob, token: Int) {
        val newToken = synchronized(stateLock) {
            if (resolveToken != token || resolving !== job) {
                null
            } else {
                job.attempts += 1
                resolveToken += 1
                resolveToken
            }
        } ?: return
        startResolve(job, newToken)
    }

    private fun finishResolve(token: Int) {
        synchronized(stateLock) {
            if (resolveToken != token) return
            resolving = null
            resolveToken += 1
        }
        pumpResolve()
    }

    private fun emitServiceFound(name: String, info: NsdServiceInfo) {
        synchronized(stateLock) {
            if (discoveryListener == null) return
        }
        val host = pickHost(info) ?: return
        val meta = JSObject()
        val attrs = info.attributes
        if (attrs != null) {
            for ((key, value) in attrs) {
                if (key == null) continue
                meta.put(key, if (value != null) String(value, Charsets.UTF_8) else "")
            }
        }
        val ev = JSObject()
        ev.put("name", name)
        ev.put("host", host)
        ev.put("port", info.port)
        ev.put("meta", meta)
        notifyListeners("serviceFound", ev)
    }

    /** Prefer an IPv4 address; fall back to whatever NSD resolved. */
    @Suppress("DEPRECATION")
    private fun pickHost(info: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val all = info.hostAddresses
            val v4 = all.firstOrNull { it is Inet4Address }
            if (v4 != null) return v4.hostAddress
            val legacy = info.host
            if (legacy != null) return legacy.hostAddress
            return all.firstOrNull()?.hostAddress
        }
        return info.host?.hostAddress
    }

    /** Some Android versions report names with DNS escapes ("My\032Game"); decode them. */
    private fun unescapeServiceName(raw: String): String {
        if (raw.indexOf('\\') < 0) return raw
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < raw.length) {
            val c = raw[i]
            if (c == '\\' && i + 3 < raw.length &&
                raw[i + 1].isDigit() && raw[i + 2].isDigit() && raw[i + 3].isDigit()
            ) {
                val value = raw.substring(i + 1, i + 4).toInt()
                if (value <= 255) {
                    out.write(value)
                    i += 4
                    continue
                }
            }
            if (c == '\\' && i + 1 < raw.length) {
                i += 1
            }
            val cp = raw.codePointAt(i)
            val n = Character.charCount(cp)
            out.write(raw.substring(i, i + n).toByteArray(Charsets.UTF_8))
            i += n
        }
        return String(out.toByteArray(), Charsets.UTF_8)
    }

    // =====================================================================
    // Client
    // =====================================================================

    @PluginMethod
    fun connect(call: PluginCall) {
        val host: String? = call.getString("host")
        val port: Int? = call.getInt("port")
        if (host.isNullOrBlank() || port == null || port < 1 || port > 65535) {
            call.reject("host and a port between 1 and 65535 are required", "INVALID_ARGUMENT")
            return
        }
        disconnectInternal()
        val remote = try {
            InetSocketAddress(InetAddress.getByName(host), port)
        } catch (e: Exception) {
            call.reject("Invalid host: $host", "INVALID_ARGUMENT", e)
            return
        }
        val socket = try {
            configureSocket(DatagramSocket())
        } catch (e: Exception) {
            call.reject("Could not open UDP socket: ${e.message}", "BIND_FAILED", e)
            return
        }
        synchronized(stateLock) {
            clientSocket = socket
            clientRemote = remote
        }
        startReceiveThread(socket, HOST_PEER, "JayuLan-client-rx")
        call.resolve()
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        disconnectInternal()
        call.resolve()
    }

    private fun disconnectInternal() {
        val socket = synchronized(stateLock) {
            val s = clientSocket
            clientSocket = null
            clientRemote = null
            s
        }
        socket?.close()
    }

    // =====================================================================
    // Datagrams
    // =====================================================================

    private fun startReceiveThread(socket: DatagramSocket, fixedPeerId: String?, name: String) {
        val thread = Thread({ receiveLoop(socket, fixedPeerId) }, name)
        thread.isDaemon = true
        thread.start()
    }

    private fun receiveLoop(socket: DatagramSocket, fixedPeerId: String?) {
        // One extra byte lets us detect (and drop) datagrams larger than MAX_DATAGRAM.
        val buffer = ByteArray(MAX_DATAGRAM + 1)
        val packet = DatagramPacket(buffer, buffer.size)
        while (!socket.isClosed) {
            try {
                packet.setData(buffer, 0, buffer.size)
                socket.receive(packet)
                val length = packet.length
                if (length > MAX_DATAGRAM) continue
                val peerId: String
                if (fixedPeerId != null) {
                    peerId = fixedPeerId
                } else {
                    val address = packet.address ?: continue
                    peerId = "${address.hostAddress}:${packet.port}"
                    if (!peerCache.containsKey(peerId) && peerCache.size < MAX_PEER_CACHE) {
                        peerCache[peerId] = InetSocketAddress(address, packet.port)
                    }
                }
                val ev = JSObject()
                ev.put("peerId", peerId)
                ev.put("data", Base64.encodeToString(buffer, 0, length, Base64.NO_WRAP))
                notifyListeners("message", ev)
            } catch (e: Exception) {
                if (socket.isClosed) break
                emitError("Receive failed: ${e.message}", "RECEIVE_FAILED")
                try {
                    Thread.sleep(20)
                } catch (ie: InterruptedException) {
                    break
                }
            }
        }
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val peerId: String? = call.getString("peerId")
        val data: String? = call.getString("data")
        if (peerId == null || data == null) {
            call.reject("peerId and data are required", "INVALID_ARGUMENT")
            return
        }
        val target = targetFor(peerId)
        if (target == null) {
            call.reject("No open socket for peer $peerId", "NOT_CONNECTED")
            return
        }
        enqueue(listOf(Outgoing(target.first, target.second, data)))
        call.resolve()
    }

    @PluginMethod
    fun sendBatch(call: PluginCall) {
        val messages: JSArray? = call.getArray("messages")
        if (messages == null) {
            call.reject("messages is required", "INVALID_ARGUMENT")
            return
        }
        val out = ArrayList<Outgoing>(messages.length())
        for (i in 0 until messages.length()) {
            val obj = messages.optJSONObject(i) ?: continue
            val peerId = obj.optString("peerId", "")
            val data = obj.optString("data", "")
            if (peerId.isEmpty()) continue
            val target = targetFor(peerId) ?: continue
            out.add(Outgoing(target.first, target.second, data))
        }
        enqueue(out)
        call.resolve()
    }

    /** Host socket: peerId "ip:port". Client socket: peerId "host" = connected remote. */
    private fun targetFor(peerId: String): Pair<DatagramSocket, InetSocketAddress>? {
        return synchronized(stateLock) {
            if (peerId == HOST_PEER) {
                val s = clientSocket
                val r = clientRemote
                if (s != null && r != null) return Pair(s, r)
            }
            val hs = hostSocket ?: return null
            val cached = peerCache[peerId]
            val address = cached ?: parsePeerId(peerId) ?: return null
            if (cached == null && peerCache.size < MAX_PEER_CACHE) peerCache[peerId] = address
            Pair(hs, address)
        }
    }

    private fun parsePeerId(peerId: String): InetSocketAddress? {
        val idx = peerId.lastIndexOf(':')
        if (idx <= 0 || idx == peerId.length - 1) return null
        val ip = peerId.substring(0, idx).removePrefix("[").removeSuffix("]")
        val port = peerId.substring(idx + 1).toIntOrNull() ?: return null
        if (port < 1 || port > 65535) return null
        return try {
            InetSocketAddress(InetAddress.getByName(ip), port)
        } catch (e: Exception) {
            null
        }
    }

    private fun enqueue(items: List<Outgoing>) {
        if (items.isEmpty()) return
        try {
            sendExecutor.execute {
                for (item in items) sendNow(item)
            }
        } catch (e: RejectedExecutionException) {
            // Plugin is being destroyed.
        }
    }

    private fun sendNow(item: Outgoing) {
        if (item.socket.isClosed) return
        val bytes = try {
            Base64.decode(item.data, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            emitError("Invalid base64 payload", "INVALID_DATA")
            return
        }
        if (bytes.size > MAX_DATAGRAM) {
            emitError("Datagram larger than 16 KB dropped (${bytes.size} bytes)", "TOO_LARGE")
            return
        }
        try {
            item.socket.send(DatagramPacket(bytes, bytes.size, item.address))
        } catch (e: Exception) {
            if (!item.socket.isClosed) emitError("Send failed: ${e.message}", "SEND_FAILED")
        }
    }

    // =====================================================================
    // Misc
    // =====================================================================

    @PluginMethod
    fun getLocalAddresses(call: PluginCall) {
        val ret = JSObject()
        ret.put("addresses", toJSArray(localIPv4Addresses()))
        call.resolve(ret)
    }

    /** Android has no Local Network permission (INTERNET is a normal permission). */
    @PluginMethod
    fun checkLocalNetwork(call: PluginCall) {
        val ret = JSObject()
        ret.put("status", "granted")
        call.resolve(ret)
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val ctx = context
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", ctx.packageName, null)
            )
            val act = activity
            if (act != null) {
                act.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("Could not open settings: ${e.message}", "UNAVAILABLE", e)
        }
    }

    private fun localIPv4Addresses(): List<String> {
        val preferred = ArrayList<String>()
        val others = ArrayList<String>()
        val interfaces = try {
            NetworkInterface.getNetworkInterfaces()
        } catch (e: Exception) {
            null
        }
        if (interfaces == null) return emptyList()
        for (iface in interfaces.toList()) {
            try {
                if (!iface.isUp || iface.isLoopback) continue
                val name = iface.name ?: ""
                if (EXCLUDED_IFACE_PREFIXES.any { name.startsWith(it) }) continue
                val isPreferred = PREFERRED_IFACE_PREFIXES.any { name.startsWith(it) }
                for (addr in iface.inetAddresses.toList()) {
                    if (addr !is Inet4Address || addr.isLoopbackAddress || addr.isAnyLocalAddress) continue
                    val ip = addr.hostAddress ?: continue
                    if (isPreferred) preferred.add(ip) else others.add(ip)
                }
            } catch (ignored: Exception) {
            }
        }
        return (preferred + others).distinct()
    }

    private fun toJSArray(values: List<String>): JSArray {
        val arr = JSArray()
        for (v in values) arr.put(v)
        return arr
    }

    /** Hold a multicast lock while hosting or discovering, so mDNS packets reach us. */
    private fun updateMulticastLock() {
        synchronized(stateLock) {
            val needed = hostSocket != null || discoveryListener != null
            if (needed) {
                if (multicastLock == null) {
                    val wifi = context?.applicationContext?.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                    multicastLock = wifi?.createMulticastLock("JayuLan")?.apply { setReferenceCounted(false) }
                }
                val lock = multicastLock
                if (lock != null && !lock.isHeld) {
                    try {
                        lock.acquire()
                    } catch (ignored: Exception) {
                    }
                }
            } else {
                val lock = multicastLock
                if (lock != null && lock.isHeld) {
                    try {
                        lock.release()
                    } catch (ignored: Exception) {
                    }
                }
            }
        }
    }

    /** Emits an 'error' event, at most once per second per code (send errors can repeat at tick rate). */
    private fun emitError(message: String, code: String) {
        val now = SystemClock.elapsedRealtime()
        val last = lastErrorAt[code]
        if (last != null && now - last < ERROR_THROTTLE_MS) return
        lastErrorAt[code] = now
        val ev = JSObject()
        ev.put("message", message)
        ev.put("code", code)
        notifyListeners("error", ev)
    }

    override fun handleOnDestroy() {
        stopDiscoveryInternal()
        stopHostInternal()
        disconnectInternal()
        sendExecutor.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        super.handleOnDestroy()
    }
}
