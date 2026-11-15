/**
 * Procedural audio: every sound effect and music bed is synthesised at runtime with WebAudio,
 * so the game ships no third-party audio files (nothing to license, tiny download).
 */
export type Sfx =
  | 'shot_light'
  | 'shot_heavy'
  | 'shot_shotgun'
  | 'shot_sniper'
  | 'shot_rocket'
  | 'shot_launcher'
  | 'shot_rail'
  | 'shot_blade'
  | 'flame'
  | 'explosion'
  | 'explosion_small'
  | 'hit'
  | 'hit_head'
  | 'hurt'
  | 'kill'
  | 'death'
  | 'pickup'
  | 'health'
  | 'reload'
  | 'empty'
  | 'throw'
  | 'bounce'
  | 'melee'
  | 'jet_start'
  | 'flag'
  | 'score'
  | 'countdown'
  | 'go'
  | 'win'
  | 'lose'
  | 'ui_click'
  | 'ui_hover'
  | 'ui_back'
  | 'ui_toggle'
  | 'beep'
  | 'wave'
  | 'level_up';

type Bus = 'sfx' | 'ui' | 'music';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private buffers = new Map<Sfx, AudioBuffer>();
  private volumes = { master: 0.8, sfx: 0.9, ui: 0.7, music: 0.5 };
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private musicBed = 0;
  private jetNodes = new Map<number, { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode }>();
  private noise: AudioBuffer | null = null;
  private lastPlay = new Map<Sfx, number>();
  private unlocked = false;

  /**
   * Create the (suspended) AudioContext and start synthesising sounds ahead of time. Constructing an
   * AudioContext costs ~100 ms of main-thread time, so the app calls this when idle after boot; the
   * first tap then only has to resume it.
   */
  prepare(): void {
    if (this.ctx) return;
    try {
      this.create();
    } catch {
      this.ctx = null;
    }
  }

  /** Must be called from a user gesture on iOS/Safari. Safe to call repeatedly. */
  unlock(): void {
    if (this.unlocked && this.ctx?.state === 'running') return;
    try {
      if (!this.ctx) this.create();
      void this.ctx!.resume();
      this.unlocked = true;
    } catch {
      this.ctx = null;
    }
  }

  private create(): void {
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    for (const b of ['sfx', 'ui', 'music'] as Bus[]) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    this.applyVolumes();
    this.build();
  }

  setVolumes(v: { master: number; sfx: number; ui: number; music: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.02);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.02);
    this.buses.ui.gain.setTargetAtTime(this.volumes.ui, t, 0.02);
    this.buses.music.gain.setTargetAtTime(this.volumes.music * 0.35, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.unlocked) void this.ctx?.resume();
  }

  // ------------------------------------------------------------ synthesis

  private render(seconds: number, fn: (t: number, i: number, sr: number) => number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const n = Math.max(1, Math.floor(seconds * sr));
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = fn(i / sr, i, sr);
    // Normalise.
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < n; i++) d[i] = (d[i] / peak) * 0.9;
    return buf;
  }

  private build(): void {
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    this.noise = this.render(1, () => rnd());
    const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
    // Filtered noise helper (one-pole low-pass with a moving cutoff).
    const shot = (len: number, cutoff: number, decay: number, body: number, bodyFreq: number) => {
      let lp = 0;
      return this.render(len, (t) => {
        const c = Math.min(0.99, (cutoff * Math.exp(-t * 18)) / 22050);
        lp += (rnd() - lp) * c;
        return lp * env(t, 0.001, decay) + Math.sin(2 * Math.PI * bodyFreq * t * Math.exp(-t * 20)) * body * env(t, 0.001, decay * 0.7);
      });
    };
    const tone = (len: number, f0: number, f1: number, type: 'sine' | 'square' | 'tri', decay: number) =>
      this.render(len, (t) => {
        const f = f0 + (f1 - f0) * (t / len);
        const ph = 2 * Math.PI * f * t;
        const w = type === 'sine' ? Math.sin(ph) : type === 'square' ? Math.sign(Math.sin(ph)) * 0.6 : (2 / Math.PI) * Math.asin(Math.sin(ph));
        return w * env(t, 0.004, decay);
      });
    const chord = (len: number, freqs: number[], decay: number) =>
      this.render(len, (t) => freqs.reduce((a, f, k) => a + Math.sin(2 * Math.PI * f * t) * env(t - k * 0.06, 0.005, decay) * (t > k * 0.06 ? 1 : 0), 0));
    // Jobs instead of eager synthesis: UI sounds are built immediately (they are tiny and needed on the
    // very first tap); everything else is rendered in idle slices so the first gesture never freezes.
    const jobs: [Sfx, () => AudioBuffer][] = [];
    const b = { set: (name: Sfx, mk: AudioBuffer | (() => AudioBuffer)) => jobs.push([name, typeof mk === 'function' ? mk : () => mk]) };
    b.set('shot_light', () => shot(0.18, 9000, 0.05, 0.4, 180));
    b.set('shot_heavy', () => shot(0.28, 7000, 0.08, 0.7, 120));
    b.set('shot_shotgun', () => shot(0.45, 6000, 0.14, 0.9, 90));
    b.set('shot_sniper', () => shot(0.7, 10000, 0.2, 0.8, 70));
    b.set('shot_rocket', () => this.render(0.6, (t) => rnd() * env(t, 0.02, 0.25) * 0.6 + Math.sin(2 * Math.PI * (300 - t * 300) * t) * env(t, 0.01, 0.2) * 0.4));
    b.set('shot_launcher', () => tone(0.25, 220, 90, 'sine', 0.08));
    b.set('shot_rail', () => this.render(0.6, (t) => Math.sin(2 * Math.PI * (1800 - 1500 * t) * t) * env(t, 0.005, 0.18) + rnd() * env(t, 0.001, 0.05) * 0.4));
    b.set('shot_blade', () => this.render(0.35, (t) => Math.sin(2 * Math.PI * (900 + Math.sin(t * 80) * 200) * t) * env(t, 0.01, 0.12)));
    b.set('flame', () => (() => {
      let lp = 0;
      return this.render(0.25, (t) => {
        lp += (rnd() - lp) * 0.08;
        return lp * env(t, 0.03, 0.12);
      });
    })());
    const boom = (len: number, cutoff: number) => {
      let lp = 0;
      return this.render(len, (t) => {
        lp += (rnd() - lp) * Math.min(0.9, (cutoff * Math.exp(-t * 3)) / 22050);
        return lp * env(t, 0.004, len * 0.3) + Math.sin(2 * Math.PI * 50 * t) * env(t, 0.01, 0.25) * 0.8;
      });
    };
    b.set('explosion', () => boom(1.4, 2500));
    b.set('explosion_small', () => boom(0.7, 3500));
    b.set('hit', () => tone(0.08, 1400, 900, 'square', 0.025));
    b.set('hit_head', () => tone(0.14, 2200, 1700, 'square', 0.04));
    b.set('hurt', () => tone(0.18, 300, 160, 'tri', 0.06));
    b.set('kill', () => chord(0.5, [880, 1320], 0.12));
    b.set('death', () => tone(0.6, 400, 80, 'tri', 0.2));
    b.set('pickup', () => chord(0.3, [660, 990], 0.08));
    b.set('health', () => chord(0.45, [523, 659, 784], 0.1));
    b.set('reload', () => this.render(0.35, (t) => (t < 0.05 || (t > 0.22 && t < 0.27) ? rnd() * env(t % 0.22, 0.001, 0.02) : 0)));
    b.set('empty', () => tone(0.06, 1800, 1800, 'square', 0.01));
    b.set('throw', () => this.render(0.2, (t) => rnd() * env(t, 0.05, 0.05) * 0.5));
    b.set('bounce', () => tone(0.08, 500, 300, 'tri', 0.02));
    b.set('melee', () => this.render(0.2, (t) => rnd() * env(t, 0.01, 0.04) + Math.sin(2 * Math.PI * 140 * t) * env(t, 0.005, 0.05)));
    b.set('jet_start', () => this.render(0.25, (t) => rnd() * env(t, 0.06, 0.08) * 0.6));
    b.set('flag', () => chord(0.6, [523, 784, 1046], 0.15));
    b.set('score', () => chord(0.7, [659, 880, 1318], 0.18));
    b.set('countdown', () => tone(0.15, 880, 880, 'sine', 0.06));
    b.set('go', () => chord(0.5, [880, 1318], 0.15));
    b.set('win', () => chord(1.4, [523, 659, 784, 1046], 0.35));
    b.set('lose', () => chord(1.2, [392, 330, 262], 0.35));
    b.set('ui_click', () => tone(0.06, 1200, 900, 'sine', 0.02));
    b.set('ui_hover', () => tone(0.04, 1600, 1600, 'sine', 0.012));
    b.set('ui_back', () => tone(0.08, 700, 500, 'sine', 0.025));
    b.set('ui_toggle', () => tone(0.06, 900, 1300, 'sine', 0.02));
    b.set('beep', () => tone(0.1, 1500, 1500, 'square', 0.03));
    b.set('wave', () => chord(1.0, [262, 392, 523], 0.3));
    b.set('level_up', () => chord(1.2, [523, 659, 784, 1046, 1318], 0.25));
    const ui = jobs.filter(([n]) => n.startsWith('ui_'));
    const rest = jobs.filter(([n]) => !n.startsWith('ui_'));
    for (const [n, mk] of ui) this.buffers.set(n, mk());
    const step = () => {
      const t0 = performance.now();
      while (rest.length && performance.now() - t0 < 8) {
        const [n, mk] = rest.shift()!;
        this.buffers.set(n, mk());
      }
      if (rest.length) setTimeout(step, 16);
    };
    setTimeout(step, 0);
  }

  /** Play a sound. `pan` -1..1, `vol` 0..1; `x`-based panning/attenuation is done by the caller. */
  play(name: Sfx, vol = 1, pan = 0, rate = 1, bus: Bus = name.startsWith('ui_') ? 'ui' : 'sfx'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    // Voice limiting: the same sound at most every 30 ms.
    const now = ctx.currentTime;
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, vol));
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(this.buses[bus]);
    src.start();
  }

  /** Continuous jetpack hiss per player id. */
  jet(id: number, on: boolean, vol = 1, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    let n = this.jetNodes.get(id);
    if (on && !n) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(filter).connect(gain).connect(p).connect(this.buses.sfx);
      src.start();
      n = { src, gain, pan: p };
      this.jetNodes.set(id, n);
    }
    if (!n) return;
    const t = ctx.currentTime;
    n.gain.gain.setTargetAtTime(on ? 0.12 * vol : 0, t, 0.04);
    n.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
    if (!on && n.gain.gain.value < 0.002) {
      n.src.stop();
      this.jetNodes.delete(id);
    }
  }

  stopAllJets(): void {
    for (const n of this.jetNodes.values()) {
      try {
        n.src.stop();
      } catch {
        // already stopped
      }
    }
    this.jetNodes.clear();
  }

  // ------------------------------------------------------------ music

  /** Simple generative music bed: a bass line + arpeggio + hats, varied per map. */
  startMusic(bed: number): void {
    this.stopMusic();
    if (!this.ctx) return;
    this.musicBed = bed;
    this.musicStep = 0;
    const scales = [
      [0, 3, 5, 7, 10],
      [0, 2, 4, 7, 9],
      [0, 2, 3, 7, 8],
      [0, 3, 5, 6, 10],
      [0, 2, 5, 7, 9],
    ];
    const roots = [45, 43, 41, 47, 40, 42, 44, 46, 38, 48];
    const scale = scales[bed % scales.length];
    const root = roots[bed % roots.length];
    const bpm = 112 + (bed % 4) * 8;
    const stepMs = 60000 / bpm / 4;
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    const prog = [0, 0, 3, 4, 0, 0, 2, 4];
    this.musicTimer = setInterval(() => {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const s = this.musicStep++;
      const bar = Math.floor(s / 16) % prog.length;
      const deg = prog[bar];
      const t = ctx.currentTime + 0.05;
      const note = (freq: number, dur: number, vol: number, type: OscillatorType) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.buses.music);
        o.start(t);
        o.stop(t + dur + 0.02);
      };
      if (s % 4 === 0) note(midi(root + scale[deg % scale.length] - 12), 0.28, 0.5, 'triangle');
      if (s % 2 === 0) {
        const k = (s / 2) % 4;
        note(midi(root + 12 + scale[(deg + k * 2) % scale.length] + (k === 3 ? 12 : 0)), 0.16, 0.12, this.musicBed % 2 ? 'square' : 'sawtooth');
      }
      if (s % 4 === 2 && this.noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        src.connect(hp).connect(g).connect(this.buses.music);
        src.start(t, Math.random() * 0.5, 0.06);
      }
      if (s % 16 === 0 || s % 16 === 10) note(55, 0.25, 0.6, 'sine');
    }, stepMs);
  }

  stopMusic(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const audio = new AudioEngine();
