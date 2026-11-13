import type { PluginListenerHandle } from '@capacitor/core';

/** Bonjour/NSD service type for LAN matches (<= 15 chars, lowercase). */
export const LAN_SERVICE_TYPE = '_jayubrawl._udp';
export const LAN_DEFAULT_PORT = 47820;

export interface LanServiceInfo {
  /** Unique service instance name, e.g. "Jayu-ABC123". */
  name: string;
  host: string;
  port: number;
  /** TXT record values: code, hostName, mode, map, players, max, v (protocol version). */
  meta: Record<string, string>;
}

export interface LanMessageEvent {
  /** "ip:port" of the remote peer (host side), or "host" (client side). */
  peerId: string;
  /** Datagram payload, base64. */
  data: string;
}

export type LocalNetworkPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * First-party Capacitor plugin: raw UDP datagrams + Bonjour (iOS) / NSD (Android) discovery.
 * Reliability, ordering and the game protocol live in TypeScript on top of this.
 */
export interface LanPlugin {
  /** Bind a UDP socket on `port` (0 = any) and advertise the service. */
  startHost(options: { port?: number; serviceName: string; meta: Record<string, string> }): Promise<{ port: number; addresses: string[] }>;
  stopHost(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  /** Client: bind an ephemeral UDP socket whose remote is host:port. */
  connect(options: { host: string; port: number }): Promise<void>;
  disconnect(): Promise<void>;
  /** Host: peerId = "ip:port". Client: peerId = "host". */
  send(options: { peerId: string; data: string }): Promise<void>;
  /** Send many datagrams in one bridge call (snapshot fan-out). */
  sendBatch(options: { messages: { peerId: string; data: string }[] }): Promise<void>;
  getLocalAddresses(): Promise<{ addresses: string[] }>;
  /** iOS: triggers / reports the Local Network permission. Android: always "granted". */
  checkLocalNetwork(): Promise<{ status: LocalNetworkPermission }>;
  /** Opens the app's page in system Settings (to re-enable Local Network access). */
  openSettings(): Promise<void>;
  addListener(event: 'message', fn: (e: LanMessageEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'serviceFound', fn: (e: LanServiceInfo) => void): Promise<PluginListenerHandle>;
  addListener(event: 'serviceLost', fn: (e: { name: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', fn: (e: { message: string; code: string }) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
