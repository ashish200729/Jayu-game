import { Client, type Room } from '@colyseus/sdk';
import type { LobbySettings } from './protocol';
import type { ClientTransport } from './transport';

export type OnlineJoin =
  | { kind: 'quick'; region: string }
  | { kind: 'create'; region: string; settings?: Partial<LobbySettings> }
  | { kind: 'join'; code: string };

export interface OnlineConnection {
  transport: ClientTransport;
  code: string;
}

/** Joins a Colyseus room and exposes it as a ClientTransport (binary messages on channel "m"). */
export async function connectOnline(endpoint: string, join: OnlineJoin): Promise<OnlineConnection> {
  const client = new Client(endpoint);
  let room: Room;
  if (join.kind === 'quick') room = await client.joinOrCreate('match', { quick: true, region: join.region });
  else if (join.kind === 'create') room = await client.create('match', { quick: false, region: join.region, settings: join.settings });
  else room = await client.joinById(join.code.trim().toUpperCase());
  let open = true;
  const transport: ClientTransport = {
    kind: 'online',
    onMessage: null,
    onClose: null,
    send(data) {
      if (open) room.sendBytes('m', data);
    },
    close() {
      if (!open) return;
      open = false;
      void room.leave(true);
    },
  };
  room.onMessage('m', (data: Uint8Array) => transport.onMessage?.(data));
  room.onLeave((code: number) => {
    if (!open) return;
    open = false;
    transport.onClose?.(`left:${code}`);
  });
  room.onError((code: number, message?: string) => {
    if (!open) return;
    open = false;
    transport.onClose?.(`error:${code}:${message ?? ''}`);
  });
  return { transport, code: room.roomId };
}
