/**
 * One Transport interface, three implementations (local in-process, Colyseus online, LAN plugin).
 * Gameplay code never knows which one is active. Messages are opaque byte arrays; the protocol layer
 * tolerates loss, duplication and reordering (inputs are redundant, snapshots are self-contained deltas
 * against acknowledged baselines, and one-off messages are re-requested).
 */
export interface ClientTransport {
  readonly kind: 'local' | 'online' | 'lan';
  send(data: Uint8Array): void;
  onMessage: ((data: Uint8Array) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(): void;
}

/** The host's handle to one connected client. */
export interface PeerLink {
  send(data: Uint8Array): void;
  close(reason: string): void;
}

export interface NetConditions {
  latencyMs: number;
  jitterMs: number;
  loss: number;
}

export const PERFECT: NetConditions = { latencyMs: 0, jitterMs: 0, loss: 0 };

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

export const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

/**
 * Inputs, pings and snapshots are designed to tolerate loss; everything else (hello, lobby actions,
 * start/roster/end) must be delivered reliably and in order by the transport.
 */
export function isReliableMessage(data: Uint8Array): boolean {
  const t = data[0];
  return !(t === 2 || t === 4 || t === 24 || t === 26);
}

/** Deterministic seeded RNG for the network simulator so tests are reproducible. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Delivers a message after simulated one-way latency/jitter, or drops it.
 * Used by the dev-build network simulator and by the netcode test suite.
 */
export class LinkSimulator {
  private rand: () => number;
  bytes = 0;
  messages = 0;
  dropped = 0;
  constructor(
    public conditions: NetConditions,
    private clock: Clock = realClock,
    seed = 1,
  ) {
    this.rand = lcg(seed);
  }

  private lastReliableAt = 0;

  deliver(data: Uint8Array, fn: (data: Uint8Array) => void): void {
    this.bytes += data.length;
    this.messages++;
    const c = this.conditions;
    const reliable = isReliableMessage(data);
    if (!reliable && c.loss > 0 && this.rand() < c.loss) {
      this.dropped++;
      return;
    }
    const copy = data.slice();
    let delay = c.latencyMs + (c.jitterMs > 0 ? (this.rand() * 2 - 1) * c.jitterMs : 0);
    if (reliable) {
      // Reliable channel: never lost, delivered in order (like TCP or the LAN reliability layer).
      const at = Math.max(this.clock.now() + delay, this.lastReliableAt);
      this.lastReliableAt = at;
      delay = at - this.clock.now();
    }
    if (delay <= 0) fn(copy);
    else this.clock.setTimeout(() => fn(copy), Math.max(0, delay));
  }
}

/** In-process transport pair: one client side, one host-side peer link. */
export function createLocalPair(
  hostReceive: (data: Uint8Array) => void,
  hostClosed: () => void,
  conditions: NetConditions = PERFECT,
  clock: Clock = realClock,
  seed = 1,
  kind: ClientTransport['kind'] = 'local',
): { client: ClientTransport; link: PeerLink; up: LinkSimulator; down: LinkSimulator } {
  const up = new LinkSimulator(conditions, clock, seed);
  const down = new LinkSimulator(conditions, clock, seed + 7919);
  let open = true;
  const client: ClientTransport = {
    kind,
    onMessage: null,
    onClose: null,
    send(data) {
      if (!open) return;
      up.deliver(data, (d) => open && hostReceive(d));
    },
    close() {
      if (!open) return;
      open = false;
      hostClosed();
    },
  };
  const link: PeerLink = {
    send(data) {
      if (!open) return;
      down.deliver(data, (d) => open && client.onMessage?.(d));
    },
    close(reason) {
      if (!open) return;
      // Like a socket close: messages already in flight are still delivered first.
      const finish = () => {
        if (!open) return;
        open = false;
        client.onClose?.(reason);
      };
      const wait = conditions.latencyMs + conditions.jitterMs;
      if (wait <= 0) finish();
      else clock.setTimeout(finish, wait + 1);
    },
  };
  return { client, link, up, down };
}
