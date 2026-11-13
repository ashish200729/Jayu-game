import { ByteReader, ByteWriter } from './codec';
import { Msg } from './protocol';
import { isReliableMessage, realClock, type ClientTransport, type Clock, type PeerLink } from './transport';
import type { MatchHost } from './host';

/**
 * LAN play runs over raw UDP (native plugin). This module adds what UDP lacks for the control
 * messages that need it: sequence numbers, acks, resends and in-order delivery. Inputs and snapshots
 * stay unreliable — the game protocol already tolerates their loss.
 *
 * Frame: u8 kind (0 = unreliable, 1 = reliable, 2 = ack, 3 = keepalive) [u16 seq] payload...
 */
const K_UNRELIABLE = 0;
const K_RELIABLE = 1;
const K_ACK = 2;
const K_KEEPALIVE = 3;
const RESEND_MS = 150;
const MAX_TRIES = 40;
const TIMEOUT_MS = 10000;
const KEEPALIVE_MS = 1000;

export class ReliableChannel {
  private nextSeq = 0;
  private expected = 0;
  private unacked = new Map<number, { frame: Uint8Array; at: number; tries: number }>();
  private future = new Map<number, Uint8Array>();
  private lastRecv: number;
  private lastSend: number;
  dead = false;

  constructor(
    private sendFrame: (frame: Uint8Array) => void,
    private deliver: (payload: Uint8Array) => void,
    private clock: Clock = realClock,
  ) {
    this.lastRecv = clock.now();
    this.lastSend = clock.now();
  }

  send(payload: Uint8Array): void {
    if (this.dead) return;
    const w = new ByteWriter(payload.length + 3);
    if (isReliableMessage(payload)) {
      const seq = this.nextSeq;
      this.nextSeq = (this.nextSeq + 1) & 0xffff;
      w.u8(K_RELIABLE);
      w.u16(seq);
      w.bytes(payload);
      const frame = w.finish();
      this.unacked.set(seq, { frame, at: this.clock.now(), tries: 1 });
      this.raw(frame);
    } else {
      w.u8(K_UNRELIABLE);
      w.bytes(payload);
      this.raw(w.finish());
    }
  }

  private raw(frame: Uint8Array): void {
    this.lastSend = this.clock.now();
    this.sendFrame(frame);
  }

  receive(frame: Uint8Array): void {
    if (this.dead || frame.length < 1) return;
    this.lastRecv = this.clock.now();
    const r = new ByteReader(frame);
    const kind = r.u8();
    if (kind === K_UNRELIABLE) {
      this.deliver(frame.subarray(1));
    } else if (kind === K_RELIABLE) {
      if (frame.length < 3) return;
      const seq = r.u16();
      const ack = new Uint8Array([K_ACK, seq & 0xff, seq >> 8]);
      this.raw(ack);
      const ahead = (seq - this.expected) & 0xffff;
      if (ahead >= 0x8000) return; // old duplicate
      this.future.set(seq, frame.slice(3));
      while (this.future.has(this.expected)) {
        const p = this.future.get(this.expected)!;
        this.future.delete(this.expected);
        this.expected = (this.expected + 1) & 0xffff;
        this.deliver(p);
      }
      if (this.future.size > 512) this.dead = true;
    } else if (kind === K_ACK) {
      if (frame.length < 3) return;
      this.unacked.delete(r.u16());
    }
  }

  update(now = this.clock.now()): void {
    if (this.dead) return;
    if (now - this.lastRecv > TIMEOUT_MS) {
      this.dead = true;
      return;
    }
    for (const [seq, u] of this.unacked) {
      if (now - u.at < RESEND_MS) continue;
      if (u.tries >= MAX_TRIES) {
        this.dead = true;
        return;
      }
      u.at = now;
      u.tries++;
      this.raw(u.frame);
      void seq;
    }
    if (now - this.lastSend > KEEPALIVE_MS) this.raw(new Uint8Array([K_KEEPALIVE]));
  }
}

/** Minimal datagram socket the LAN transports run on (native plugin on phones, node:dgram in tests). */
export interface ClientDatagramSocket {
  send(data: Uint8Array): void;
  onData: ((data: Uint8Array) => void) | null;
  close(): void;
}

export interface HostDatagramSocket {
  send(peerId: string, data: Uint8Array): void;
  onData: ((peerId: string, data: Uint8Array) => void) | null;
  close(): void;
}

/** Client side of a LAN match. */
export function createLanClientTransport(socket: ClientDatagramSocket, clock: Clock = realClock): ClientTransport & { update(): void } {
  let open = true;
  const t: ClientTransport & { update(): void } = {
    kind: 'lan',
    onMessage: null,
    onClose: null,
    send(data) {
      if (open) channel.send(data);
    },
    close() {
      if (!open) return;
      open = false;
      socket.close();
      t.onClose?.('closed');
    },
    update() {
      if (!open) return;
      channel.update();
      if (channel.dead) {
        open = false;
        socket.close();
        t.onClose?.('timeout');
      }
    },
  };
  const channel = new ReliableChannel(
    (f) => socket.send(f),
    (p) => t.onMessage?.(p),
    clock,
  );
  socket.onData = (d) => channel.receive(d);
  return t;
}

/** Wires a UDP host socket to a MatchHost: one reliable channel per remote "ip:port". */
export class LanHostBridge {
  private channels = new Map<string, ReliableChannel>();

  constructor(
    private host: MatchHost,
    private socket: HostDatagramSocket,
    private clock: Clock = realClock,
    private maxPeers = 16,
  ) {
    socket.onData = (peerId, data) => this.onData(peerId, data);
  }

  private onData(peerId: string, data: Uint8Array): void {
    let ch = this.channels.get(peerId);
    if (!ch) {
      // Only a reliable HELLO may open a new peer; stray datagrams are ignored.
      if (data.length < 4 || data[0] !== K_RELIABLE || data[3] !== Msg.Hello) return;
      if (this.channels.size >= this.maxPeers) return;
      const channel = new ReliableChannel(
        (f) => this.socket.send(peerId, f),
        (p) => this.host.receive(peerId, p),
        this.clock,
      );
      ch = channel;
      this.channels.set(peerId, channel);
      const link: PeerLink = {
        send: (d) => channel.send(d),
        close: () => {
          // Give the reliable close/reject message a moment to flush before forgetting the peer.
          this.clock.setTimeout(() => this.channels.delete(peerId), 500);
        },
      };
      this.host.connect(peerId, link);
    }
    ch.receive(data);
  }

  update(): void {
    for (const [peerId, ch] of this.channels) {
      ch.update();
      if (ch.dead) {
        this.channels.delete(peerId);
        this.host.disconnect(peerId);
      }
    }
  }

  get peerCount(): number {
    return this.channels.size;
  }

  close(): void {
    this.channels.clear();
    this.socket.close();
  }
}
