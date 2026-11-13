# @game/lan — JayuLan Capacitor plugin

First-party Capacitor 8 plugin for local Wi-Fi / hotspot matches. The native side does two jobs:

- **Raw UDP datagrams.** It binds sockets, sends and receives bytes, and nothing more. Reliability, ordering and the game protocol are handled in TypeScript above it.
- **Local service discovery** of the `_jayubrawl._udp` service: Bonjour (Network.framework) on iOS, NSD on Android.

The TypeScript API is defined in `src/definitions.ts`. The plugin is registered as `JayuLan`.

| Method | What it does |
| --- | --- |
| `startHost({ port?, serviceName, meta })` | Binds UDP on `port` (default `47820`; if that port is busy it uses an ephemeral port; `0` means any port). Advertises `_jayubrawl._udp` with `meta` as TXT records. Resolves `{ port, addresses }`, where `addresses` is the device's IPv4 LAN addresses, including the hotspot interface. |
| `stopHost()` | Stops advertising and closes the socket. |
| `startDiscovery()` / `stopDiscovery()` | Browses `_jayubrawl._udp`. Emits `serviceFound` `{ name, host (IPv4), port, meta }` and `serviceLost` `{ name }`. |
| `connect({ host, port })` / `disconnect()` | Client socket on an ephemeral port. Incoming datagrams arrive with `peerId: "host"`. |
| `send({ peerId, data })` / `sendBatch({ messages })` | `data` is base64. On the host, `peerId` is the `"ip:port"` that arrived on `message` events. On a client, `peerId` is `"host"`. Sending happens off the bridge thread. |
| `getLocalAddresses()` | Non-loopback IPv4 addresses of interfaces that are up. Cellular and VPN interfaces are skipped. |
| `checkLocalNetwork()` | iOS: `granted` / `denied` / `prompt` / `unknown`; the first call triggers the system prompt. Android: always `granted`. |
| `openSettings()` | Opens this app's page in system Settings. |

Events:
- `message` `{ peerId, data }`
- `serviceFound`
- `serviceLost`
- `error` `{ message, code }`

`error` codes are `BIND_FAILED`, `ADVERTISE_FAILED`, `DISCOVERY_FAILED`, `DISCOVERY_WAITING`, `RECEIVE_FAILED`, `SEND_FAILED`, `INVALID_DATA`, `TOO_LARGE`, `HOST_FAILED`, `CONNECTION_FAILED` and `LOCAL_NETWORK_DENIED`. Each code is emitted at most once per second.

Datagrams larger than **16 KB** are dropped in both directions.

On the host, a peer can only be sent to after it has sent at least one datagram. Its `"ip:port"` is learned from that datagram.

## iOS setup (host app)

Add these keys to `ios/App/App/Info.plist`:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Jayu uses your local network to find and join matches with friends on the same Wi-Fi or hotspot.</string>
<key>NSBonjourServices</key>
<array>
  <string>_jayubrawl._udp</string>
</array>
```

- **The multicast entitlement (`com.apple.developer.networking.multicast`) is not needed.** Discovery uses Bonjour (NWListener service + NWBrowser), not raw multicast or broadcast sockets.
- Call `checkLocalNetwork()` before hosting or browsing, for example from a "Play on local Wi-Fi" screen. The first call shows the system prompt. iOS has no API that reports this permission, so the plugin advertises a short-lived probe service (`JayuLanProbe-…`) and browses for it:
  - Any browse result means `granted`.
  - A `PolicyDenied` DNS error means `denied`.
  - If neither happens within about 2 seconds, the result is `prompt` when the browser is running and `unknown` otherwise.

  While the prompt is still on screen, iOS can already report `PolicyDenied`, so a first-ever call may return `denied`. Call it again after the user answers. On `denied`, offer `openSettings()`.
- Probe services are filtered out of `serviceFound` on both platforms.
- Supports iOS 15+, through Swift Package Manager (`Package.swift`) or CocoaPods (`JayuLan.podspec`). `PrivacyInfo.xcprivacy` declares no tracking, no collected data and no required-reason APIs.

## Android setup

The plugin's manifest merges in these permissions. The host app does not need to add them:

- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `ACCESS_WIFI_STATE`
- `CHANGE_WIFI_MULTICAST_STATE`, so a `WifiManager.MulticastLock` can be held while hosting or discovering and mDNS packets get through.

All four are normal (install-time) permissions, so Android never shows a runtime prompt.

The library targets compileSdk 36, minSdk 24, targetSdk 36 and Java 21.

Discovery uses `NsdManager`. Resolves are queued because Android before API 34 allows only one resolve at a time. A retry handles `FAILURE_ALREADY_ACTIVE`, and a watchdog handles resolves that never call back.

### 16 KB page size

The Android side is pure Kotlin/Java: `DatagramSocket`, `NsdManager` and no NDK. It ships **no native `.so` libraries**, so Google Play's 16 KB memory page size requirement does not affect this plugin.

## Implementation notes

- **Android threading.** Each socket has a daemon receive thread, and one single-threaded executor sends all datagrams. Shared state is guarded by a lock. `handleOnDestroy` closes everything and releases the multicast lock.
- **iOS threading.** All Network.framework objects run on one serial `DispatchQueue`:
  - The host is an `NWListener` (UDP) with one `NWConnection` per remote `"ip:port"`.
  - The client is an `NWConnection`.
  - Discovery is an `NWBrowser`. Each result is resolved to an IPv4 `host`/`port` through a short-lived IPv4-only UDP `NWConnection` to the service endpoint; nothing is sent.
