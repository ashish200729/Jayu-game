import type { Clock } from '@game/net';

/** Deterministic virtual clock with a timer queue, so network tests run fast and reproducibly. */
export class VirtualClock implements Clock {
  t = 0;
  private q: { at: number; fn: () => void; seq: number }[] = [];
  private seq = 0;
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    this.q.push({ at: this.t + ms, fn, seq: this.seq++ });
    return this.seq;
  }
  /** Advance time, running due timers in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.q.length; i++) {
        const e = this.q[i];
        if (e.at <= end && (best < 0 || e.at < this.q[best].at || (e.at === this.q[best].at && e.seq < this.q[best].seq))) best = i;
      }
      if (best < 0) break;
      const e = this.q.splice(best, 1)[0];
      this.t = Math.max(this.t, e.at);
      e.fn();
    }
    this.t = end;
  }
}
