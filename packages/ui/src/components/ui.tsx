import { motion, AnimatePresence } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
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
  primary: 'bg-sun text-ink shadow-chunky hover:brightness-105 active:translate-y-1 active:shadow-none',
  secondary: 'bg-panel-2 text-text shadow-chunky hover:bg-line active:translate-y-1 active:shadow-none',
  ghost: 'bg-transparent text-text hover:bg-white/10 active:bg-white/15',
  danger: 'bg-danger text-white shadow-chunky hover:brightness-105 active:translate-y-1 active:shadow-none',
  mint: 'bg-mint text-ink shadow-chunky hover:brightness-105 active:translate-y-1 active:shadow-none',
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
  const sz = size === 'sm' ? 'min-h-10 px-3 text-sm rounded-md' : size === 'lg' ? 'min-h-14 px-6 text-xl rounded-lg' : size === 'xl' ? 'min-h-16 px-8 text-3xl rounded-xl' : 'min-h-12 px-4 text-base rounded-md';
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
      className={`font-display font-extrabold tracking-wide select-none transition-all duration-[var(--duration-fast)] ease-[var(--ease-snap)] disabled:opacity-40 disabled:pointer-events-none border-2 border-ink inline-flex items-center justify-center gap-2 ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-panel/90 border-2 border-ink rounded-lg shadow-soft backdrop-blur-sm ${className}`}>{children}</div>;
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
      className="flex items-center justify-between gap-4 w-full min-h-12 px-3 rounded-md hover:bg-white/5 text-left"
    >
      <span className="text-text">{label}</span>
      <span className={`relative w-14 h-8 rounded-full border-2 border-ink transition-colors duration-[var(--duration-base)] ${value ? 'bg-mint' : 'bg-line'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white border-2 border-ink transition-all duration-[var(--duration-base)] ${value ? 'left-6' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05, format }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  return (
    <label className="flex items-center justify-between gap-4 w-full min-h-12 px-3 rounded-md hover:bg-white/5">
      <span className="text-text shrink-0">{label}</span>
      <span className="flex items-center gap-3 w-1/2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-[var(--color-sun)] h-2"
          aria-label={label}
        />
        <span className="w-12 text-right text-muted tabular-nums text-sm">{format ? format(value) : `${Math.round(value * 100)}%`}</span>
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 w-full min-h-12 px-3">
      {label && <span className="text-text shrink-0">{label}</span>}
      <div className="flex rounded-md border-2 border-ink overflow-hidden" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === value}
            onClick={() => {
              sfx('ui_toggle');
              onChange(o.value);
            }}
            className={`px-3 min-h-10 text-sm font-bold transition-colors duration-[var(--duration-fast)] ${o.value === value ? 'bg-sun text-ink' : 'bg-panel-2 text-text hover:bg-line'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Full-screen page with a title bar and back button. */
export function Page({ title, children, back = 'menu', actions, testId }: { title: string; children: ReactNode; back?: Screen | (() => void); actions?: ReactNode; testId?: string }) {
  const reduce = useStore(app, (s) => s.settings.accessibility.reduceMotion);
  return (
    <motion.div
      data-testid={testId}
      initial={reduce ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? undefined : { opacity: 0, x: -24 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="absolute inset-0 flex flex-col safe"
    >
      <header className="flex items-center gap-3 mb-3 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          sound="ui_back"
          testId="back"
          onClick={() => (typeof back === 'function' ? back() : go(back))}
          className="!min-h-11 !px-3"
        >
          ← {t('common.back')}
        </Button>
        <h1 className="font-display font-extrabold text-2xl md:text-3xl text-sun drop-shadow-[0_3px_0_#1b1d26] truncate">{title}</h1>
        <div className="ml-auto flex gap-2">{actions}</div>
      </header>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
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
          className="absolute inset-0 z-40 grid place-items-center bg-night/70 safe"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ scale: 0.92, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="bg-panel border-2 border-ink rounded-xl shadow-soft p-5 max-w-[min(92vw,560px)] max-h-[88vh] overflow-auto w-full"
          >
            {title && <h2 className="font-display font-extrabold text-2xl text-sun mb-3">{title}</h2>}
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
    <div className="pointer-events-none absolute z-50 top-3 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center" aria-live="polite">
      <AnimatePresence>
        {toasts.map((x) => (
          <motion.div
            key={x.id}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className={`px-4 py-2 rounded-md border-2 border-ink shadow-chunky font-bold ${x.kind === 'error' ? 'bg-danger text-white' : x.kind === 'success' ? 'bg-mint text-ink' : 'bg-panel-2 text-text'}`}
          >
            {t(x.text)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Chip({ children, color = 'bg-panel-2' }: { children: ReactNode; color?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border-2 border-ink text-xs font-bold ${color}`}>{children}</span>;
}
