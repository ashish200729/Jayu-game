import { Lan, LAN_DEFAULT_PORT, type LanServiceInfo, type LocalNetworkPermission } from '@game/lan';
import type { ClientDatagramSocket, HostDatagramSocket } from '@game/net';

function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Host socket on the native plugin. Sends are batched per frame to keep bridge calls low. */
export async function openLanHost(serviceName: string, meta: Record<string, string>): Promise<{ socket: HostDatagramSocket & { flush(): void }; port: number; addresses: string[] }> {
  let queue: { peerId: string; data: string }[] = [];
  let handle: { remove(): Promise<void> } | null = null;
  const socket: HostDatagramSocket & { flush(): void } = {
    onData: null,
    send(peerId, data) {
      queue.push({ peerId, data: toB64(data) });
    },
    flush() {
      if (!queue.length) return;
      const messages = queue;
      queue = [];
      void Lan.sendBatch({ messages }).catch(() => undefined);
    },
    close() {
      void handle?.remove();
      void Lan.stopHost();
    },
  };
  handle = await Lan.addListener('message', (e) => {
    if (e.peerId !== 'host') socket.onData?.(e.peerId, fromB64(e.data));
  });
  const r = await Lan.startHost({ port: LAN_DEFAULT_PORT, serviceName, meta });
  return { socket, port: r.port, addresses: r.addresses };
}

export async function openLanClient(host: string, port: number): Promise<ClientDatagramSocket> {
  let handle: { remove(): Promise<void> } | null = null;
  const socket: ClientDatagramSocket = {
    onData: null,
    send(data) {
      void Lan.send({ peerId: 'host', data: toB64(data) }).catch(() => undefined);
    },
    close() {
      void handle?.remove();
      void Lan.disconnect();
    },
  };
  handle = await Lan.addListener('message', (e) => {
    if (e.peerId === 'host') socket.onData?.(fromB64(e.data));
  });
  await Lan.connect({ host, port });
  return socket;
}

export async function startLanDiscovery(onChange: (list: LanServiceInfo[]) => void): Promise<() => void> {
  const found = new Map<string, LanServiceInfo>();
  const a = await Lan.addListener('serviceFound', (s) => {
    found.set(s.name, s);
    onChange([...found.values()]);
  });
  const b = await Lan.addListener('serviceLost', (s) => {
    found.delete(s.name);
    onChange([...found.values()]);
  });
  await Lan.startDiscovery();
  return () => {
    void a.remove();
    void b.remove();
    void Lan.stopDiscovery();
  };
}

export async function localNetworkStatus(): Promise<LocalNetworkPermission> {
  try {
    return (await Lan.checkLocalNetwork()).status;
  } catch {
    return 'unknown';
  }
}

export async function openAppSettings(): Promise<void> {
  try {
    await Lan.openSettings();
  } catch {
    // not available on web
  }
}

export async function localAddresses(): Promise<string[]> {
  try {
    return (await Lan.getLocalAddresses()).addresses;
  } catch {
    return [];
  }
}
