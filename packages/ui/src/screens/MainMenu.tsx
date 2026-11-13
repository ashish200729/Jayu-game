import { motion } from 'motion/react';
import { useState } from 'react';
import { isProfane, randomName, sanitizeName } from '@game/net';
import { app, go, quickMatch, startOffline, updateProfile } from '../core/app';
import { levelInfo } from '../core/profile';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/icons';
import { Button, Modal, ProgressBar, Spinner, SparksBadge, TextInput, sfx, useMotionOk, useViewport } from '../components/ui';
import type { Screen } from '../core/app';

/** Validate a display name; returns an i18n error key or ''. */
export function nameError(raw: string): string {
  const s = raw.trim();
  if (s.length < 2 || s.length > 16) return 'name.errLength';
  if (isProfane(s)) return 'name.errProfane';
  if (sanitizeName(s) !== s.replace(/\s+/g, ' ')) return 'name.errChars';
  return '';
}

function ModeCard({ icon, title, sub, onClick, testId, tone }: { icon: IconName; title: string; sub: string; onClick: () => void; testId: string; tone: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onPointerEnter={() => sfx('ui_hover')}
      onClick={() => {
        sfx('ui_click');
        onClick();
      }}
      className="group flex items-center gap-2.5 min-h-14 p-2 pr-3 rounded-lg border-2 border-ink bg-panel/95 shadow-chunky text-left hover:bg-panel-2 hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all duration-[var(--duration-fast)] ease-[var(--ease-snap)] min-w-0"
    >
      <span className={`grid place-items-center shrink-0 w-10 h-10 rounded-md border-2 border-ink text-ink ${tone}`}>
        <Icon name={icon} className="w-6 h-6" />
      </span>
      <span className="min-w-0">
        <span className="block font-display font-extrabold leading-tight truncate">{title}</span>
        <span className="block text-xs text-muted leading-tight truncate">{sub}</span>
      </span>
    </button>
  );
}

function NavButton({ icon, label, screen, testId }: { icon: IconName; label: string; screen: Screen; testId: string }) {
  return (
    <Button size="sm" variant="secondary" testId={testId} onClick={() => go(screen)} title={label} className="!min-h-11 !px-2.5 md:!px-3">
      <Icon name={icon} className="w-5 h-5" />
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}

function NameModal({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    const e = nameError(name);
    setErr(e);
    if (e) return;
    const clean = sanitizeName(name);
    updateProfile((p) => ({ ...p, name: clean }));
    onDone();
  };
  return (
    <Modal open={open} title={t('name.welcome')} testId="name-modal">
      <p className="text-muted mb-3">{t('name.prompt')}</p>
      <div className="flex gap-2 items-end">
        <TextInput
          className="flex-1"
          label={t('name.label')}
          value={name}
          onChange={(v) => {
            setName(v);
            if (err) setErr('');
          }}
          maxLength={16}
          placeholder={t('name.placeholder')}
          testId="name-input"
          autoFocus
          onEnter={save}
          invalid={!!err}
        />
        <Button variant="secondary" onClick={() => setName(randomName())} title={t('name.random')} className="!min-h-12">
          {t('name.random')}
        </Button>
      </div>
      <p className={`text-sm mt-1.5 min-h-5 ${err ? 'text-danger font-bold' : 'text-muted'}`} role={err ? 'alert' : undefined}>
        {err ? t(err) : t('name.hint')}
      </p>
      <div className="flex justify-end mt-3">
        <Button variant="primary" size="lg" testId="name-save" onClick={save} disabled={name.trim().length < 2}>
          {t('common.continue')}
        </Button>
      </div>
    </Modal>
  );
}

export function MainMenu() {
  const profile = useStore(app, (s) => s.profile);
  const { w, h } = useViewport();
  const motionOk = useMotionOk();
  const [connecting, setConnecting] = useState(false);
  const [askTutorial, setAskTutorial] = useState(false);
  const lvl = levelInfo(profile.xp);
  const needName = !profile.name;
  const dailyDone = profile.daily.filter((c) => c.claimed).length;
  const avatarSize = Math.round(Math.max(120, Math.min(h * 0.52, w * 0.28, 440)));

  const play = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await quickMatch();
      go('lobby');
    } catch {
      setConnecting(false);
    }
  };

  return (
    <motion.div
      data-testid="main-menu"
      initial={motionOk ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={motionOk ? { opacity: 0 } : undefined}
      transition={{ duration: 0.24 }}
      className="absolute inset-0 safe flex flex-col"
    >
      {/* Top bar: profile badge + navigation */}
      <header className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            sfx('ui_click');
            go('profile');
          }}
          className="flex items-center gap-2.5 min-h-12 pl-1.5 pr-3 py-1 rounded-lg border-2 border-ink bg-panel/90 shadow-chunky hover:bg-panel-2 text-left min-w-0"
          aria-label={t('menu.profileBadge', { name: profile.name || t('name.guest'), n: lvl.level })}
        >
          <span className="grid place-items-center w-9 h-9 rounded-md bg-sun text-ink font-display font-extrabold text-lg border-2 border-ink shrink-0">{lvl.level}</span>
          <span className="min-w-0">
            <span className="block font-display font-extrabold leading-tight truncate max-w-[9rem] md:max-w-[14rem]">{profile.name || t('name.guest')}</span>
            <ProgressBar value={lvl.need ? lvl.into / lvl.need : 1} className="!h-2 w-24 md:w-36 mt-0.5" label={t('profile.xp')} />
          </span>
        </button>
        <SparksBadge n={profile.sparks} className="hidden sm:inline-flex" />
        <button
          type="button"
          onClick={() => {
            sfx('ui_click');
            go('profile');
          }}
          className="hidden md:inline-flex items-center gap-1.5 min-h-8 px-2.5 rounded-full border-2 border-ink bg-panel-2 text-xs font-bold hover:bg-line"
          data-testid="daily-chip"
        >
          <Icon name="star" className="w-3.5 h-3.5 text-sun" />
          {t('menu.daily', { n: dailyDone, of: profile.daily.length })}
        </button>
        <nav className="ml-auto flex gap-1.5 md:gap-2" aria-label={t('menu.nav')}>
          <NavButton icon="shirt" label={t('nav.armoury')} screen="armoury" testId="nav-armoury" />
          <NavButton icon="user" label={t('nav.profile')} screen="profile" testId="nav-profile" />
          <NavButton icon="gear" label={t('nav.settings')} screen="settings" testId="nav-settings" />
          <NavButton icon="star" label={t('nav.credits')} screen="credits" testId="nav-credits" />
        </nav>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 md:gap-8 items-center">
        {/* Showcase */}
        <section className="relative flex flex-col items-center justify-center min-h-0 h-full">
          <div className="text-center leading-none select-none">
            <div className="font-display font-extrabold text-sun text-[clamp(2.4rem,9vh,7rem)] tracking-wider drop-shadow-[0_5px_0_var(--color-ink)] [-webkit-text-stroke:2px_var(--color-ink)]">
              {t('app.name').toUpperCase()}
            </div>
            <div className="font-display font-bold text-text/90 text-[clamp(0.85rem,2.6vh,1.6rem)] tracking-[0.25em] uppercase -mt-1">{t('app.tagline')}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              sfx('ui_click');
              go('armoury');
            }}
            aria-label={t('nav.armoury')}
            className="relative rounded-full mt-1"
          >
            <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 bottom-[10%] w-[70%] h-[14%] rounded-[50%] bg-sun/25 blur-md" />
            <motion.div
              animate={motionOk ? { y: [0, -10, 0] } : undefined}
              transition={motionOk ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
            >
              <Avatar loadout={profile.loadout} size={avatarSize} animate={motionOk} />
            </motion.div>
          </button>
        </section>

        {/* Play + modes */}
        <section className="flex flex-col gap-2.5 md:gap-4 min-h-0 max-h-full overflow-y-auto py-1 px-1 -mx-1">
          <motion.div
            initial={motionOk ? { scale: 0.92, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1], delay: 0.05 }}
          >
            <Button variant="primary" size="xl" testId="play-quick" onClick={play} disabled={connecting} autoFocus={!needName} className="w-full !min-h-16 md:!min-h-20 md:!text-4xl">
              {connecting ? <Spinner className="!w-7 !h-7" /> : <Icon name="play" className="w-8 h-8" />}
              {connecting ? t('menu.connecting') : t('menu.play')}
            </Button>
            <p className="text-center text-xs text-text/80 mt-1.5 font-bold">{t('menu.playSub')}</p>
          </motion.div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
            <ModeCard icon="lock" title={t('menu.private')} sub={t('menu.privateSub')} onClick={() => go('online')} testId="mode-private" tone="bg-sky" />
            <ModeCard icon="wifi" title={t('menu.lan')} sub={t('menu.lanSub')} onClick={() => go('lan')} testId="mode-lan" tone="bg-mint" />
            <ModeCard icon="bot" title={t('menu.bots')} sub={t('menu.botsSub')} onClick={() => go('bots')} testId="mode-bots" tone="bg-coral" />
            <ModeCard icon="waves" title={t('menu.survival')} sub={t('menu.survivalSub')} onClick={() => go('survival')} testId="mode-survival" tone="bg-sun" />
            <ModeCard icon="target" title={t('menu.training')} sub={t('menu.trainingSub')} onClick={() => go('training')} testId="mode-training" tone="bg-panel-2 !text-text" />
            <ModeCard icon="shirt" title={t('nav.armoury')} sub={t('menu.armourySub')} onClick={() => go('armoury')} testId="mode-armoury" tone="bg-sky" />
          </div>
        </section>
      </main>

      <NameModal open={needName} onDone={() => setAskTutorial(!app.get().profile.tutorialDone)} />
      <Modal open={askTutorial && !needName} onClose={() => setAskTutorial(false)} title={t('tutorial.offerTitle')} testId="tutorial-offer">
        <p className="text-text mb-4">{t('tutorial.offerBody', { name: profile.name })}</p>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" onClick={() => setAskTutorial(false)} testId="tutorial-skip">
            {t('tutorial.skip')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            autoFocus
            testId="tutorial-start"
            onClick={() => {
              setAskTutorial(false);
              startOffline({ mapId: 'training-grounds', mode: 'training' }, 'tutorial');
            }}
          >
            {t('tutorial.start')}
          </Button>
        </div>
      </Modal>
    </motion.div>
  );
}
