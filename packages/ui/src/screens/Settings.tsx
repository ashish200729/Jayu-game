import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { app, measurePings, updateSettings } from '../core/app';
import { ACTIONS, DEFAULT_KEYMAP, TEAM_COLORS, defaultTouchLayout, type Action, type Settings, type TouchControl, type TouchLayout } from '../core/settings';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { AccountPanel } from '../components/account';
import { Icon } from '../components/icons';
import { hex } from '../components/match';
import { Button, Page, Panel, SectionTitle, Segmented, Slider, Tabs, Toggle, sfx } from '../components/ui';
import { PingBadge } from './Online';

type TabId = 'graphics' | 'controls' | 'audio' | 'accessibility' | 'network' | 'language' | 'account';
const TABS: TabId[] = ['graphics', 'controls', 'audio', 'accessibility', 'network', 'language', 'account'];

/** Patch one settings section. */
function patch<K extends 'audio' | 'graphics' | 'controls' | 'accessibility' | 'network'>(key: K, p: Partial<Settings[K]>): void {
  updateSettings((s) => ({ ...s, [key]: { ...s[key], ...p } }));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `×${v.toFixed(2)}`;

// ------------------------------------------------------------------ graphics / audio

function Graphics({ s }: { s: Settings }) {
  const g = s.graphics;
  return (
    <Panel className="py-2">
      <Segmented
        label={t('settings.quality')}
        value={g.quality}
        onChange={(quality) => patch('graphics', { quality })}
        options={[
          { value: 'low', label: t('settings.low') },
          { value: 'medium', label: t('settings.medium') },
          { value: 'high', label: t('settings.high') },
        ]}
      />
      <Toggle label={t('settings.batterySaver')} value={g.batterySaver} onChange={(batterySaver) => patch('graphics', { batterySaver })} />
      <Toggle label={t('settings.shake')} value={g.shake} onChange={(shake) => patch('graphics', { shake })} />
      <Toggle label={t('settings.damageNumbers')} value={g.damageNumbers} onChange={(damageNumbers) => patch('graphics', { damageNumbers })} />
      <Toggle label={t('settings.showFps')} value={g.showFps} onChange={(showFps) => patch('graphics', { showFps })} />
      <Toggle label={t('settings.reduceFlashes')} value={g.reduceFlashes} onChange={(reduceFlashes) => patch('graphics', { reduceFlashes })} />
    </Panel>
  );
}

function Audio({ s }: { s: Settings }) {
  const a = s.audio;
  return (
    <Panel className="py-2">
      <Slider label={t('settings.master')} value={a.master} onChange={(master) => patch('audio', { master })} />
      <Slider label={t('settings.music')} value={a.music} onChange={(music) => patch('audio', { music })} />
      <Slider label={t('settings.sfx')} value={a.sfx} onChange={(sfxV) => patch('audio', { sfx: sfxV })} />
      <Slider label={t('settings.ui')} value={a.ui} onChange={(ui) => patch('audio', { ui })} />
    </Panel>
  );
}

// ------------------------------------------------------------------ controls

const STICKS: TouchControl[] = ['move', 'aim'];

function LayoutEditor({ s }: { s: Settings }) {
  const preset = s.controls.preset;
  const saved = s.controls.layouts[preset] ?? defaultTouchLayout();
  const [draft, setDraft] = useState<TouchLayout>(saved);
  const [sel, setSel] = useState<TouchControl>('move');
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: TouchControl; id: number } | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setFull(false);
    };
    window.addEventListener('keydown', h, { capture: true });
    return () => window.removeEventListener('keydown', h, { capture: true });
  }, [full]);

  useEffect(() => {
    setDraft(s.controls.layouts[preset] ?? defaultTouchLayout());
  }, [s.controls.layouts, preset]);

  const commit = (next: TouchLayout) => {
    setDraft(next);
    updateSettings((st) => {
      const layouts = st.controls.layouts.slice();
      layouts[st.controls.preset] = next;
      return { ...st, controls: { ...st.controls, layouts } };
    });
  };
  const edit = (key: TouchControl, p: Partial<TouchLayout[TouchControl]>, save = true) => {
    const next = { ...draft, [key]: { ...draft[key], ...p } };
    if (save) commit(next);
    else setDraft(next);
  };
  const toFrac = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    const c = (v: number) => Math.round(Math.max(0.03, Math.min(0.97, v)) * 1000) / 1000;
    return { x: c((e.clientX - r.left) / r.width), y: c((e.clientY - r.top) / r.height) };
  };
  const onDown = (key: TouchControl) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    setSel(key);
    drag.current = { key, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    edit(drag.current.key, toFrac(e), false);
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const key = drag.current.key;
    drag.current = null;
    commit({ ...draft, [key]: { ...draft[key], ...toFrac(e) } });
  };
  const onKey = (key: TouchControl) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const d = e.shiftKey ? 0.05 : 0.01;
    const c = draft[key];
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
    const v = m[e.key];
    if (!v) return;
    e.preventDefault();
    edit(key, { x: Math.max(0.03, Math.min(0.97, c.x + v[0])), y: Math.max(0.03, Math.min(0.97, c.y + v[1])) });
  };

  const cur = draft[sel];
  const keys = Object.keys(defaultTouchLayout()) as TouchControl[];

  const canvas = (className: string) => (
    <div ref={box} className={`[container-type:size] overflow-hidden bg-gradient-to-b from-panel-2 to-night touch-none select-none ${className}`} data-testid={full ? 'layout-editor-full' : 'layout-editor'} aria-label={t('settings.layoutEditor')}>
      <div className="absolute inset-x-0 bottom-0 h-[22%] bg-line/40 border-t-2 border-line" aria-hidden="true" />
      <div className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 text-muted/50 font-display font-extrabold text-sm md:text-lg pointer-events-none whitespace-nowrap">{t('settings.dragHint')}</div>
      {keys.map((k) => {
        const c = draft[k];
        const base = STICKS.includes(k) ? 26 : 13;
        const d = base * c.size;
        const on = sel === k;
        return (
          <button
            key={k}
            type="button"
            data-testid={`layout-${k}`}
            aria-label={t(`touch.${k}`)}
            aria-pressed={on}
            onPointerDown={onDown(k)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={onKey(k)}
            onClick={() => setSel(k)}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full grid place-items-center overflow-hidden font-extrabold text-ink cursor-grab active:cursor-grabbing border-2 ${on ? 'border-sun ring-4 ring-sun/40 z-10 shadow-[0_0_20px_rgb(255_200_70/0.6)]' : 'border-white/50'} ${c.visible ? 'bg-white/85 backdrop-blur-sm' : 'bg-transparent border-dashed !text-muted'}`}
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, height: `${d}%`, aspectRatio: '1', fontSize: `${(d * (STICKS.includes(k) ? 0.16 : 0.24)).toFixed(2)}cqh`, opacity: c.visible ? Math.max(0.35, c.opacity) : 0.6 }}
          >
            <span className="px-0.5 leading-none text-center">{t(`touch.${k}.short`)}</span>
          </button>
        );
      })}
    </div>
  );

  const step = (v: number, dv: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v + dv)) * 100) / 100;

  if (full) {
    return (
      <div role="dialog" aria-modal="true" aria-label={t('settings.layoutEditor')} className="fixed inset-0 z-50 bg-[radial-gradient(120%_100%_at_50%_0%,#1d1a3a,#07080f)]">
        {canvas('absolute inset-0')}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-1.5 max-w-[min(96vw,40rem)] px-2.5 py-2 rounded-[18px] glass">
          <span className="font-display font-extrabold text-sun px-1 truncate max-w-[9rem]">{t(`touch.${sel}`)}</span>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-muted">
            {t('settings.size')}
            <Button size="sm" className="!min-h-9 !px-2.5" onClick={() => edit(sel, { size: step(cur.size, -0.1, 0.6, 1.6) })}>
              −
            </Button>
            <span className="w-9 text-center text-text tabular-nums">{times(cur.size)}</span>
            <Button size="sm" className="!min-h-9 !px-2.5" onClick={() => edit(sel, { size: step(cur.size, 0.1, 0.6, 1.6) })}>
              +
            </Button>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-muted">
            {t('settings.opacity')}
            <Button size="sm" className="!min-h-9 !px-2.5" onClick={() => edit(sel, { opacity: step(cur.opacity, -0.1, 0.2, 1) })}>
              −
            </Button>
            <span className="w-9 text-center text-text tabular-nums">{pct(cur.opacity)}</span>
            <Button size="sm" className="!min-h-9 !px-2.5" onClick={() => edit(sel, { opacity: step(cur.opacity, 0.1, 0.2, 1) })}>
              +
            </Button>
          </span>
          <Button size="sm" variant={cur.visible ? 'secondary' : 'mint'} className="!min-h-9" onClick={() => edit(sel, { visible: !cur.visible })}>
            {cur.visible ? t('settings.hide') : t('settings.show')}
          </Button>
          <Button size="sm" className="!min-h-9" onClick={() => commit(defaultTouchLayout())}>
            <Icon name="refresh" className="w-4 h-4" />
            <span className="sr-only">{t('settings.resetPreset', { n: preset + 1 })}</span>
          </Button>
          <Button size="sm" variant="primary" className="!min-h-9" autoFocus onClick={() => setFull(false)} testId="layout-done">
            {t('common.done')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-[minmax(0,1.5fr)_minmax(15rem,1fr)] gap-3">
      <div className="min-w-0">
        {canvas('relative w-full max-w-[calc(52vh*16/9)] mx-auto aspect-video rounded-[18px] border border-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_18px_40px_-18px_rgb(0_0_0/0.9)]')}
        <p className="text-xs text-muted mt-1">{t('settings.layoutHint')}</p>
      </div>
      <div className="flex flex-col gap-3">
        <Button variant="primary" onClick={() => setFull(true)} testId="layout-fullscreen">
          {t('settings.editFull')}
        </Button>
        <Panel className="py-2">
          <Segmented label={t('settings.preset')} value={preset} onChange={(p) => patch('controls', { preset: p })} options={[0, 1, 2].map((i) => ({ value: i, label: String(i + 1) }))} />
          <div className="px-3 pt-1 font-display font-extrabold text-lg text-sun">{t(`touch.${sel}`)}</div>
          <Slider label={t('settings.size')} value={cur.size} min={0.6} max={1.6} step={0.05} format={times} onChange={(size) => edit(sel, { size })} />
          <Slider label={t('settings.opacity')} value={cur.opacity} min={0.2} max={1} step={0.05} format={pct} onChange={(opacity) => edit(sel, { opacity })} />
          <Toggle label={t('settings.visible')} value={cur.visible} onChange={(visible) => edit(sel, { visible })} testId="layout-visible" />
          <div className="px-3 pt-1 pb-1">
            <Button variant="secondary" size="sm" testId="layout-reset" onClick={() => commit(defaultTouchLayout())}>
              <Icon name="refresh" className="w-4 h-4" />
              {t('settings.resetPreset', { n: preset + 1 })}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const KEY_NAMES: Record<string, string> = {
  Space: 'key.space',
  Mouse0: 'key.mouse0',
  Mouse1: 'key.mouse1',
  Mouse2: 'key.mouse2',
  Mouse3: 'key.mouse3',
  Mouse4: 'key.mouse4',
  ShiftLeft: 'key.shiftLeft',
  ShiftRight: 'key.shiftRight',
  ControlLeft: 'key.ctrlLeft',
  ControlRight: 'key.ctrlRight',
  AltLeft: 'key.altLeft',
  AltRight: 'key.altRight',
  Escape: 'key.esc',
  Enter: 'key.enter',
  Backspace: 'key.backspace',
  CapsLock: 'key.caps',
};

export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return t(KEY_NAMES[code]);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const arrows: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  return arrows[code] ?? code;
}

function Keymap({ s }: { s: Settings }) {
  const [listen, setListen] = useState<Action | null>(null);
  const map = s.controls.keymap;
  const bind = (a: Action, code: string) => {
    updateSettings((st) => {
      const cur = st.controls.keymap[a] ?? [];
      const next = [code, ...cur.filter((c) => c !== code)].slice(0, 2);
      return { ...st, controls: { ...st.controls, keymap: { ...st.controls.keymap, [a]: next } } };
    });
    sfx('ui_toggle');
    setListen(null);
  };
  const unbind = (a: Action, code: string) => {
    updateSettings((st) => ({ ...st, controls: { ...st.controls, keymap: { ...st.controls.keymap, [a]: st.controls.keymap[a].filter((c) => c !== code) } } }));
  };

  useEffect(() => {
    if (!listen) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.code) {
        if (e.key === 'Escape') setListen(null);
        return;
      }
      if (e.code === 'Escape' && listen !== 'pause') setListen(null);
      else bind(listen, e.code);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  });

  return (
    <div className="flex flex-col gap-2">
      <Panel className="py-1">
        <Toggle label={t('settings.holdToToggle')} value={s.controls.holdToToggle} onChange={(holdToToggle) => patch('controls', { holdToToggle })} />
      </Panel>
      <Panel className="py-1.5">
        {ACTIONS.map((a) => (
          <div key={a} className="flex items-center gap-2 min-h-12 px-3 border-b border-white/[0.06] last:border-b-0">
            <span className="flex-1 min-w-0 truncate">{t(`action.${a}`)}</span>
            <span className="flex flex-wrap gap-1 justify-end">
              {(map[a] ?? []).map((code) => (
                <button
                  key={code}
                  type="button"
                  title={t('settings.unbind', { key: keyLabel(code) })}
                  disabled={(map[a] ?? []).length <= 1}
                  onClick={() => unbind(a, code)}
                  className="group inline-flex items-center gap-1 min-h-9 px-2 rounded-[10px] well-sunken font-mono font-bold text-sm hover:!bg-danger/25 disabled:hover:!bg-black/40"
                >
                  {keyLabel(code)}
                  {(map[a] ?? []).length > 1 && <Icon name="x" className="w-3 h-3 text-muted group-hover:text-text" />}
                </button>
              ))}
            </span>
            <Button size="sm" variant={listen === a ? 'primary' : 'secondary'} onClick={() => setListen(a)} testId={`bind-${a}`} className="!min-h-10 shrink-0">
              {t('settings.bind')}
            </Button>
          </div>
        ))}
      </Panel>
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" testId="keymap-reset" onClick={() => patch('controls', { keymap: structuredClone(DEFAULT_KEYMAP) })}>
          <Icon name="refresh" className="w-4 h-4" />
          {t('settings.resetKeys')}
        </Button>
      </div>
      {listen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.pressKey')}
          className="fixed inset-0 z-50 grid place-items-center bg-[#05060c]/85 safe"
          onMouseDown={(e) => {
            e.preventDefault();
            bind(listen, `Mouse${e.button}`);
          }}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="bind-overlay"
        >
          <div className="glass rounded-[var(--radius-xl)] p-7 text-center max-w-md">
            <div className="text-sm text-muted font-bold">{t(`action.${listen}`)}</div>
            <div className="font-display font-extrabold text-3xl text-title my-2">{t('settings.pressKey')}</div>
            <div className="text-sm text-muted">{t(listen === 'pause' ? 'settings.pressKeyPause' : 'settings.pressKeyHint')}</div>
          </div>
        </div>
      )}
    </div>
  );
}

const PAD: [string, string][] = [
  ['action.move', 'pad.leftStick'],
  ['action.aim', 'pad.rightStick'],
  ['action.fire', 'RT'],
  ['action.jet', 'LT'],
  ['action.grenade', 'LB'],
  ['action.swap', 'RB'],
  ['action.reload', 'X'],
  ['action.melee', 'B'],
  ['action.crouch', 'A'],
  ['action.zoom', 'Y'],
  ['action.scoreboard', 'pad.view'],
  ['action.pause', 'pad.menu'],
];

function Gamepad() {
  return (
    <Panel className="py-1.5">
      <p className="text-sm text-muted px-3 py-1">{t('settings.padNote')}</p>
      {PAD.map(([a, b]) => (
        <div key={a} className="flex items-center justify-between min-h-11 px-3 border-b border-white/[0.06] last:border-b-0">
          <span>{t(a)}</span>
          <span className="min-w-10 text-center px-2.5 py-1 rounded-[10px] well-sunken font-bold text-sm">{b.startsWith('pad.') ? t(b) : b}</span>
        </div>
      ))}
    </Panel>
  );
}

type ControlsSub = 'touch' | 'layout' | 'keyboard' | 'gamepad';

function Controls({ s }: { s: Settings }) {
  const [sub, setSub] = useState<ControlsSub>('touch');
  const c = s.controls;
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        value={sub}
        onChange={setSub}
        options={[
          { value: 'touch', label: t('settings.touch') },
          { value: 'layout', label: t('settings.hudLayout') },
          { value: 'keyboard', label: t('settings.keyboard') },
          { value: 'gamepad', label: t('settings.gamepad') },
        ]}
      />
      {sub === 'touch' && (
        <Panel className="py-2 grid lg:grid-cols-2 gap-x-4">
          <Toggle label={t('settings.aimToFire')} value={c.aimToFire} onChange={(aimToFire) => patch('controls', { aimToFire })} />
          <Toggle label={t('settings.jetButton')} value={c.jetButton} onChange={(jetButton) => patch('controls', { jetButton })} />
          <Toggle label={t('settings.floatingSticks')} value={c.floatingSticks} onChange={(floatingSticks) => patch('controls', { floatingSticks })} />
          <Toggle label={t('settings.aimAssist')} value={c.aimAssist} onChange={(aimAssist) => patch('controls', { aimAssist })} />
          <Toggle label={t('settings.haptics')} value={c.haptics} onChange={(haptics) => patch('controls', { haptics })} />
          <Slider label={t('settings.deadZone')} value={c.deadZone} min={0} max={0.5} step={0.01} format={pct} onChange={(deadZone) => patch('controls', { deadZone })} />
          <Slider label={t('settings.sensitivity')} value={c.sensitivity} min={0.5} max={2} step={0.05} format={times} onChange={(sensitivity) => patch('controls', { sensitivity })} />
        </Panel>
      )}
      {sub === 'layout' && <LayoutEditor s={s} />}
      {sub === 'keyboard' && <Keymap s={s} />}
      {sub === 'gamepad' && <Gamepad />}
    </div>
  );
}

// ------------------------------------------------------------------ accessibility / network / language

function Accessibility({ s }: { s: Settings }) {
  const a = s.accessibility;
  const presets: Settings['accessibility']['colorblind'][] = ['none', 'protan', 'deutan', 'tritan'];
  return (
    <div className="flex flex-col gap-3">
      <Panel className="p-3">
        <SectionTitle className="!px-0">{t('settings.colorblind')}</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label={t('settings.colorblind')}>
          {presets.map((p) => {
            const on = a.colorblind === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`cb-${p}`}
                onClick={() => {
                  sfx('ui_toggle');
                  patch('accessibility', { colorblind: p });
                }}
                className={`well flex flex-col items-start gap-2 p-3 rounded-[16px] text-left min-h-12 transition-all duration-[var(--duration-fast)] ${on ? 'selected-ring' : 'hover:!bg-white/[0.07]'}`}
              >
                <span className="flex gap-1">
                  {TEAM_COLORS[p].map((c, i) => (
                    <span key={i} className="w-7 h-7 rounded-full border-2 border-white/25 shadow-[inset_0_-3px_6px_rgb(0_0_0/0.25),0_2px_8px_rgb(0_0_0/0.4)]" style={{ background: hex(c) }} />
                  ))}
                </span>
                <span className="font-bold text-sm">{t(`settings.cb.${p}`)}</span>
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel className="py-2">
        <Toggle label={t('settings.highContrast')} value={a.highContrast} onChange={(highContrast) => patch('accessibility', { highContrast })} />
        <Slider label={t('settings.uiScale')} value={a.uiScale} min={0.8} max={1.4} step={0.05} format={pct} onChange={(uiScale) => patch('accessibility', { uiScale })} />
        <Slider label={t('settings.textScale')} value={a.textScale} min={0.8} max={1.5} step={0.05} format={pct} onChange={(textScale) => patch('accessibility', { textScale })} />
        <Toggle label={t('settings.captions')} value={a.captions} onChange={(captions) => patch('accessibility', { captions })} />
        <Toggle label={t('settings.reduceMotion')} value={a.reduceMotion} onChange={(reduceMotion) => patch('accessibility', { reduceMotion })} />
      </Panel>
    </div>
  );
}

function Network({ s }: { s: Settings }) {
  const regions = useStore(app, (st) => st.regions);
  const pings = useStore(app, (st) => st.pings);
  const n = s.network;
  const dev = import.meta.env.DEV;
  return (
    <div className="flex flex-col gap-3">
      <Panel className="p-3">
        <div className="flex items-center mb-1">
          <SectionTitle className="!px-0 !mb-0 flex-1">{t('online.region')}</SectionTitle>
          <Button size="sm" variant="ghost" onClick={() => void measurePings()}>
            <Icon name="refresh" className="w-4 h-4" />
            {t('online.refresh')}
          </Button>
        </div>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('online.region')}>
          {regions.map((r) => {
            const on = r.id === n.region || (!regions.some((x) => x.id === n.region) && r === regions[0]);
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  sfx('ui_toggle');
                  patch('network', { region: r.id });
                }}
                className={`well flex items-center gap-3 min-h-12 px-3.5 rounded-[14px] text-left transition-all duration-[var(--duration-fast)] ${on ? 'selected-ring !bg-sun/[0.07]' : 'hover:!bg-white/[0.07]'}`}
              >
                <span className={`grid place-items-center w-5 h-5 rounded-full shrink-0 ${on ? 'bg-gradient-to-b from-[#ffe58a] to-[#ffb92e] shadow-[0_0_10px_rgb(255_200_70/0.7)]' : 'bg-white/10 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)]'}`}>{on && <span className="w-2 h-2 rounded-full bg-[#2a1d00]" />}</span>
                <span className="flex-1 font-bold">{r.name}</span>
                <PingBadge ms={pings[r.id]} />
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel className="py-2">
        <Toggle label={t('settings.netStats')} value={n.showNetStats} onChange={(showNetStats) => patch('network', { showNetStats })} />
      </Panel>
      {dev && (
        <Panel className="py-2">
          <div className="px-3 pt-1 font-bold text-coral">{t('settings.netSim')}</div>
          <Slider label={t('settings.simLatency')} value={n.simLatency} min={0} max={400} step={10} format={(v) => `${v} ms`} onChange={(simLatency) => patch('network', { simLatency })} />
          <Slider label={t('settings.simJitter')} value={n.simJitter} min={0} max={100} step={5} format={(v) => `${v} ms`} onChange={(simJitter) => patch('network', { simJitter })} />
          <Slider label={t('settings.simLoss')} value={n.simLoss} min={0} max={0.2} step={0.01} format={pct} onChange={(simLoss) => patch('network', { simLoss })} />
        </Panel>
      )}
    </div>
  );
}

function Language({ s }: { s: Settings }) {
  const opts: { id: Settings['language']; label: string; sub: string }[] = [
    { id: 'en', label: t('lang.en'), sub: 'English' },
    { id: 'hi', label: t('lang.hi'), sub: 'Hindi' },
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
      {opts.map((o) => {
        const on = s.language === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            lang={o.id}
            data-testid={`lang-${o.id}`}
            onClick={() => {
              sfx('ui_toggle');
              updateSettings((st) => ({ ...st, language: o.id }));
            }}
            className={`tile flex items-center gap-3 min-h-16 p-4 rounded-[20px] text-left hover:-translate-y-0.5 ${on ? 'selected-ring' : ''}`}
          >
            <span className={`grid place-items-center w-8 h-8 rounded-full shrink-0 ${on ? 'bg-gradient-to-b from-[#ffe58a] to-[#ffb92e] text-[#2a1d00] shadow-[0_0_14px_rgb(255_200_70/0.6)]' : 'bg-white/10'}`}>{on && <Icon name="check" className="w-5 h-5" strokeWidth={3} />}</span>
            <span>
              <span className="block font-display font-extrabold text-2xl leading-tight">{o.label}</span>
              <span className="block text-sm text-muted">{o.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsScreen() {
  const s = useStore(app, (st) => st.settings);
  const [tab, setTab] = useState<TabId>('graphics');
  return (
    <Page
      title={t('nav.settings')}
      testId="settings"
      toolbar={
        <div className="max-w-5xl mx-auto">
          <Tabs value={tab} onChange={setTab} testIdPrefix="settings-tab-" options={TABS.map((id) => ({ value: id, label: t(`settings.tab.${id}`) }))} />
        </div>
      }
    >
      <div className="flex flex-col gap-3 max-w-5xl mx-auto w-full">
        <div key={tab}>
          {tab === 'graphics' && <Graphics s={s} />}
          {tab === 'controls' && <Controls s={s} />}
          {tab === 'audio' && <Audio s={s} />}
          {tab === 'accessibility' && <Accessibility s={s} />}
          {tab === 'network' && <Network s={s} />}
          {tab === 'language' && <Language s={s} />}
          {tab === 'account' && <AccountPanel links />}
        </div>
      </div>
    </Page>
  );
}
