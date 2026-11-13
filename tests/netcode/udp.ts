import { createSocket, type Socket } from 'node:dgram';
import type { ClientDatagramSocket, HostDatagramSocket } from '@game/net';

/** node:dgram stand-ins for the native LAN plugin, with optional random loss for stress tests. */
export async function udpHost(loss = 0): Promise<{ socket: HostDatagramSocket; port: number }> {
  const s: Socket = createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
  const socket: HostDatagramSocket = {
    onData: null,
    send(peerId, data) {
      if (Math.random() < loss) return;
      const [ip, port] = peerId.split(':');
      s.send(data, Number(port), ip);
    },
    close() {
      s.close();
    },
  };
  s.on('message', (msg, rinfo) => socket.onData?.(`${rinfo.address}:${rinfo.port}`, new Uint8Array(msg)));
  return { socket, port: s.address().port };
}

export async function udpClient(port: number, loss = 0): Promise<ClientDatagramSocket> {
  const s: Socket = createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
  const socket: ClientDatagramSocket = {
    onData: null,
    send(data) {
      if (Math.random() < loss) return;
      s.send(data, port, '127.0.0.1');
    },
    close() {
      s.close();
    },
  };
  s.on('message', (msg) => socket.onData?.(new Uint8Array(msg)));
  return socket;
}
