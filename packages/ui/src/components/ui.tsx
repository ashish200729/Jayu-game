import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { audio } from '@game/client/audio';
import { haptic } from '@game/platform';
import { app, go, type Screen } from '../core/app';
import { useStore } from '../core/store';
import { t } from '../i18n';

export function sfx(name: 'ui_click' | 'ui_hover' | 'ui_back' | 'ui_toggle'): void {
  audio.unlock();
  audio.play(name);
  if (name === 'ui_click' && app.get().settings.controls.haptics) void haptic('light');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'mint';

const VARIANTS: Record<Variant, string> = {
  primary: 'btn btn-sun',
  secondary: 'btn btn-glass',
  ghost: 'btn btn-ghost',
  danger: 'btn btn-danger',
  mint: 'btn btn-mint',
};

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  className = '',
  testId,
  sound = 'ui_click',
  title,
  autoFocus,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  className?: string;
  testId?: string;
  sound?: 'ui_click' | 'ui_back' | 'ui_toggle' | null;
  title?: string;
  autoFocus?: boolean;
}) {
  const sz =
    size === 'sm'
      ? 'min-h-10 px-3.5 text-sm rounded-[12px] gap-1.5'
      : size === 'lg'
        ? 'min-h-14 px-6 text-xl rounded-[16px] gap-2.5'
        : size === 'xl'
          ? 'min-h-16 px-8 text-3xl rounded-[20px] gap-3'
          : 'min-h-12 px-5 text-base rounded-[14px] gap-2';
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      autoFocus={autoFocus}
      disabled={disabled}
      onPointerEnter={() => !disabled && sfx('ui_hover')}
      onClick={() => {
        if (disabled) return;
        if (sound) sfx(sound);
        onClick?.();
      }}
      className={`font-display font-extrabold tracking-wide select-none disabled:pointer-events-none inline-flex items-center justify-center whitespace-nowrap leading-none ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-[var(--radius-xl)] ${className}`}>{children}</div>;
}

export function Toggle({ value, onChange, label, testId }: { value: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      data-testid={testId}
      onClick={() => {
        sfx('ui_toggle');
        onChange(!value);
      }}
      className="flex items-center justify-between gap-4 w-full min-h-12 px-3 rounded-[12px] hover:bg-white/[0.04] text-left transition-colors duration-[var(--duration-fast)]"
    >
      <span className="text-text font-semibold">{label}</span>
      <span
        className={`relative shrink-0 w-[52px] h-[30px] rounded-full transition-all duration-[var(--duration-base)] ease-[var(--ease-snap)] ${value ? 'bg-gradient-to-b from-[#b4ff92] to-[#5fd64a] shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_0_16px_-2px_rgb(140_240_106/0.6)]' : 'well-sunken'}`}
      >
        <span
          className={`absolute top-[3px] w-6 h-6 rounded-full bg-gradient-to-b from-white to-[#dfe4ef] shadow-[0_2px_6px_rgb(0_0_0/0.45),inset_0_-1px_0_rgb(0_0_0/0.12)] transition-all duration-[var(--duration-base)] ease-[var(--ease-snap)] ${value ? 'left-[25px]' : 'left-[3px]'}`}
        />
      </span>
    </button>
  );
}

export function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05, format }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <label className="flex items-center justify-between gap-4 w-full min-h-12 px-3 rounded-[12px] hover:bg-white/[0.04]">
      <span className="text-text font-semibold shrink-0">{label}</span>
      <span className="flex items-center gap-3 w-1/2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-b [&::-webkit-slider-thumb]:from-white [&::-webkit-slider-thumb]:to-[#ffe08a] [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgb(0_0_0/0.5),0_0_0_3px_rgb(255_211_77/0.35)] [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
          style={{ background: `linear-gradient(90deg, #ffb92e 0%, #ffd34d ${pct}%, rgb(255 255 255 / 0.1) ${pct}%)` }}
          aria-label={label}
        />
        <span className="w-12 text-right text-muted tabular-nums text-sm font-bold">{format ? format(value) : `${Math.round(value * 100)}%`}</span>
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 w-full min-h-12 px-3">
      {label && <span className="text-text font-semibold shrink-0">{label}</span>}
      <div className="flex p-1 gap-1 rounded-[14px] well-sunken overflow-x-auto max-w-full" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              type="button"
              key={String(o.value)}
              role="radio"
              aria-checked={on}
              onClick={() => {
                sfx('ui_toggle');
                onChange(o.value);
              }}
              className={`shrink-0 px-3 min-h-9 rounded-[10px] text-sm font-extrabold whitespace-nowrap transition-all duration-[var(--duration-fast)] ease-[var(--ease-snap)] ${on ? 'bg-gradient-to-b from-[#ffe58a] to-[#ffc236] text-[#2a1d00] shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_4px_12px_-4px_rgb(255_185_40/0.6)]' : 'text-muted hover:text-text hover:bg-white/[0.06]'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** True when a modal dialog is open (Escape then belongs to the dialog). */
function dialogOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[role="dialog"]');
}

/** Run `fn` when Escape is pressed and no dialog is open. */
export function useEscape(fn: (() => void) | null): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !ref.current || dialogOpen()) return;
      e.preventDefault();
      sfx('ui_back');
      ref.current();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

/** Full-screen page with a title bar and back button. `back={null}` hides the back button. Escape = back. */
export function Page({ title, children, back = 'menu', actions, testId, toolbar }: { title: string; children: ReactNode; back?: Screen | (() => void) | null; actions?: ReactNode; testId?: string; toolbar?: ReactNode }) {
  const reduce = useStore(app, (s) => s.settings.accessibility.reduceMotion);
  const goBack = back === null ? null : () => (typeof back === 'function' ? back() : go(back));
  useEscape(goBack);
  return (
    <motion.div
      data-testid={testId}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      className="absolute inset-0 flex flex-col safe"
    >
      <header className="flex items-center gap-3 mb-2.5 md:mb-4 shrink-0 min-h-11 w-full max-w-[1400px] mx-auto">
        {goBack && (
          <Button variant="secondary" size="sm" sound="ui_back" testId="back" onClick={goBack} className="!min-h-11 !px-3 shrink-0" title={t('common.back')}>
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5 L8 12 L15 19" />
            </svg>
            <span className="sr-only sm:not-sr-only">{t('common.back')}</span>
          </Button>
        )}
        <div className="flex items-center gap-3 min-w-0">
          <span aria-hidden="true" className="hidden sm:block w-1.5 h-8 rounded-full bg-gradient-to-b from-[#ffe58a] to-[#ff9d2e] shadow-[0_0_14px_rgb(255_190_60/0.6)]" />
          <h1 className="font-display font-extrabold text-2xl md:text-[2rem] leading-none text-title truncate min-w-0 pt-1">{title}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">{actions}</div>
      </header>
      {toolbar && <div className="shrink-0 mb-2 w-full max-w-[1400px] mx-auto">{toolbar}</div>}
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain -mx-2 px-2 pb-3 [touch-action:pan-y]">
        <div className="w-full max-w-[1400px] mx-auto h-full">{children}</div>
      </div>
    </motion.div>
  );
}

export function Modal({ open, onClose, children, title, testId }: { open: boolean; onClose?: () => void; children: ReactNode; title?: string; testId?: string }) {
  useEffect(() => {
    if (!open || !onClose) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid={testId}
          className="absolute inset-0 z-40 grid place-items-center bg-[#05060c]/80 safe"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            // No exit animation here: the scrim's fade carries the panel out. A nested exit that starts while
            // the entrance is still running can leave AnimatePresence waiting forever (dialog never unmounts).
            initial={{ scale: 0.94, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative glass !bg-[linear-gradient(180deg,rgb(40_45_70/0.96),rgb(20_23_36/0.98))] rounded-[var(--radius-xl)] p-5 md:p-6 max-w-[min(92vw,580px)] max-h-[88vh] overflow-auto w-full"
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sun/60 to-transparent" />
            {title && <h2 className="font-display font-extrabold text-2xl md:text-3xl leading-tight text-title mb-3">{title}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useStore(app, (s) => s.toasts);
  return (
    <div className="pointer-events-none absolute z-50 top-[max(var(--sat),12px)] left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center" aria-live="polite">
      <AnimatePresence>
        {toasts.map((x) => (
          <motion.div
            key={x.id}
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="glass flex items-center gap-2.5 pl-2.5 pr-4 py-2 rounded-full font-bold text-sm"
          >
            <span className={`grid place-items-center w-6 h-6 rounded-full text-[0.8rem] font-extrabold ${x.kind === 'error' ? 'bg-danger text-white' : x.kind === 'success' ? 'bg-mint text-ink' : 'bg-sky text-ink'}`} aria-hidden="true">
              {x.kind === 'error' ? '!' : x.kind === 'success' ? '✓' : 'i'}
            </span>
            {t(x.text)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Chip({ children, color = 'bg-white/10 text-text' }: { children: ReactNode; color?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] font-extrabold leading-tight shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] ${color}`}>{children}</span>;
}

/** Horizontal tab strip (scrolls on narrow screens). */
export function Tabs<T extends string>({ value, options, onChange, testIdPrefix, className = '' }: { value: T; options: { value: T; label: string; badge?: ReactNode }[]; onChange: (v: T) => void; testIdPrefix?: string; className?: string }) {
  return (
    <div role="tablist" className={`flex gap-1 p-1 rounded-[16px] well-sunken overflow-x-auto [touch-action:pan-x] self-start w-fit max-w-full ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            type="button"
            role="tab"
            key={o.value}
            aria-selected={on}
            data-testid={testIdPrefix ? `${testIdPrefix}${o.value}` : undefined}
            onClick={() => {
              if (!on) sfx('ui_toggle');
              onChange(o.value);
            }}
            className={`shrink-0 min-h-11 px-4 rounded-[12px] font-display font-bold text-base whitespace-nowrap transition-all duration-[var(--duration-fast)] ease-[var(--ease-snap)] inline-flex items-center gap-2 ${on ? 'bg-gradient-to-b from-[#ffe58a] to-[#ffc236] text-[#2a1d00] shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_6px_16px_-6px_rgb(255_185_40/0.65)]' : 'text-muted hover:text-text hover:bg-white/[0.06]'}`}
          >
            {o.label}
            {o.badge}
          </button>
        );
      })}
    </div>
  );
}

/** Single-line text input. */
export function TextInput({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  testId,
  autoFocus,
  onEnter,
  inputMode,
  uppercase,
  invalid,
  className = '',
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  testId?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'url';
  uppercase?: boolean;
  invalid?: boolean;
  className?: string;
  mono?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      {label && <span className="eyebrow">{label}</span>}
      <input
        type="text"
        value={value}
        data-testid={testId}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        inputMode={inputMode}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize={uppercase ? 'characters' : 'off'}
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        className={`min-h-12 w-full px-4 rounded-[14px] well-sunken text-text text-lg font-bold placeholder:text-muted/50 placeholder:font-semibold select-text [user-select:text] outline-none transition-[box-shadow,border-color] duration-[var(--duration-fast)] focus:!border-sky/70 focus:shadow-[inset_0_2px_6px_rgb(0_0_0/0.45),0_0_0_3px_rgb(90_209_255/0.2)] ${invalid ? '!border-danger/80 shadow-[0_0_0_3px_rgb(255_90_79/0.18)]' : ''} ${mono ? 'font-mono tracking-[0.3em]' : ''}`}
      />
    </label>
  );
}

/** Horizontal progress bar (0..1). */
export function ProgressBar({ value, color = 'bg-sun', className = '', label }: { value: number; color?: string; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={`h-3 rounded-full well-sunken !border-0 overflow-hidden ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <div className={`relative h-full ${color} rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-snap)] shadow-[0_0_12px_-2px_currentColor]`} style={{ width: `${v * 100}%` }}>
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/35" />
      </div>
    </div>
  );
}

/** Number stepper with − / + buttons. */
export function Stepper({ value, onChange, label, min, max, step = 1, format, testId }: { value: number; onChange: (v: number) => void; label: string; min: number; max: number; step?: number; format?: (v: number) => string; testId?: string }) {
  const set = (v: number) => {
    const n = Math.max(min, Math.min(max, v));
    if (n !== value) {
      sfx('ui_toggle');
      onChange(n);
    }
  };
  const btn = 'btn btn-glass w-11 h-11 rounded-[12px] font-display font-extrabold text-xl leading-none disabled:opacity-35 disabled:pointer-events-none';
  return (
    <div className="flex items-center justify-between gap-4 w-full min-h-12 px-3" data-testid={testId}>
      <span className="text-text font-semibold">{label}</span>
      <div className="flex items-center gap-1.5" role="group" aria-label={label}>
        <button type="button" aria-label="−" disabled={value <= min} onClick={() => set(value - step)} className={btn}>
          −
        </button>
        <span className="min-w-14 px-1 text-center font-display font-extrabold text-xl tabular-nums" aria-live="polite">
          {format ? format(value) : value}
        </span>
        <button type="button" aria-label="+" disabled={value >= max} onClick={() => set(value + step)} className={btn}>
          +
        </button>
      </div>
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block w-8 h-8 rounded-full border-[3px] border-white/15 border-t-sun border-r-sun/60 animate-spin ${className}`} />;
}

/** Small heading inside panels / above sections. */
export function SectionTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`flex items-center gap-2 font-display font-extrabold text-[0.95rem] uppercase tracking-[0.12em] [:root[lang=hi]_&]:tracking-normal [:root[lang=hi]_&]:normal-case text-sun/95 px-1 mb-2 ${className}`}>
      {children}
    </h2>
  );
}

/** Selectable card (map, mode, item). */
export function SelectCard({ selected, onClick, children, className = '', testId, disabled, title }: { selected?: boolean; onClick: () => void; children: ReactNode; className?: string; testId?: string; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onPointerEnter={() => !disabled && sfx('ui_hover')}
      onClick={() => {
        sfx('ui_toggle');
        onClick();
      }}
      className={`tile relative text-left rounded-[18px] overflow-hidden disabled:opacity-50 hover:-translate-y-0.5 ${selected ? 'selected-ring -translate-y-0.5' : ''} ${className}`}
    >
      {children}
      {selected && (
        <span aria-hidden="true" className="absolute top-2 right-2 grid place-items-center w-6 h-6 rounded-full bg-gradient-to-b from-[#ffe58a] to-[#ffc236] text-[#2a1d00] shadow-[0_2px_8px_rgb(0_0_0/0.5)]">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 L10 17.5 L19 7" />
          </svg>
        </span>
      )}
    </button>
  );
}

/** Sparks currency badge. */
export function SparksBadge({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`glass inline-flex items-center gap-1.5 pl-2 pr-3 min-h-9 rounded-full font-display font-extrabold text-sun tabular-nums ${className}`} title={t('common.sparks', { n })}>
      <span className="grid place-items-center w-6 h-6 rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff1b0,#ffb92e_70%)] shadow-[0_0_12px_-2px_rgb(255_190_60/0.8)]">
        <SparkIcon className="w-3.5 h-3.5" />
      </span>
      {n.toLocaleString()}
    </span>
  );
}

export function SparkIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 0 L10 6 L16 8 L10 10 L8 16 L6 10 L0 8 L6 6 Z" fill="var(--color-sun)" stroke="#6b4300" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

/** Window size in CSS pixels (updates on resize/rotation). */
export function useViewport(): { w: number; h: number } {
  const [v, setV] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const h = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return v;
}

/** Whether decorative animation should run (honours the in-game reduce-motion setting). */
export function useMotionOk(): boolean {
  return !useStore(app, (s) => s.settings.accessibility.reduceMotion);
}
