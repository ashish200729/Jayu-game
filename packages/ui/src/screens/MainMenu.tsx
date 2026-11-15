import { motion } from 'motion/react';
import { useState } from 'react';
import { isProfane, randomName, sanitizeName } from '@game/net';
import { app, go, quickMatchOrOffline, startOffline, updateProfile } from '../core/app';
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

const TONES: Record<string, string> = {
  sky: 'from-[#9be6ff] to-[#2fa8e6] text-[#032536] shadow-[0_6px_18px_-6px_rgb(90_209_255/0.7)]',
  mint: 'from-[#c4ffa6] to-[#4fc63a] text-[#0d2a06] shadow-[0_6px_18px_-6px_rgb(140_240_106/0.6)]',
  coral: 'from-[#ffc2a6] to-[#ff6a36] text-[#3a1000] shadow-[0_6px_18px_-6px_rgb(255_122_69/0.7)]',
  sun: 'from-[#fff0a6] to-[#ffb92e] text-[#2a1d00] shadow-[0_6px_18px_-6px_rgb(255_211_77/0.7)]',
  violet: 'from-[#d9c6ff] to-[#8a63ff] text-[#170a3a] shadow-[0_6px_18px_-6px_rgb(150_110_255/0.7)]',
  rose: 'from-[#ffc6e4] to-[#ff5fa8] text-[#3a0820] shadow-[0_6px_18px_-6px_rgb(255_95_168/0.6)]',
};

function ModeCard({ icon, title, sub, onClick, testId, tone, index }: { icon: IconName; title: string; sub: string; onClick: () => void; testId: string; tone: keyof typeof TONES; index: number }) {
  const motionOk = useMotionOk();
  return (
    <motion.button
      type="button"
      data-testid={testId}
      initial={motionOk ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1], delay: 0.12 + index * 0.04 }}
      onPointerEnter={() => sfx('ui_hover')}
      onClick={() => {
        sfx('ui_click');
        onClick();
      }}
      className="tile group flex items-center gap-2.5 md:gap-3 min-h-[3.6rem] md:min-h-[4.25rem] short:!min-h-12 p-2 pr-2.5 md:p-2.5 short:!py-1.5 rounded-[18px] text-left hover:-translate-y-0.5 active:translate-y-0.5 min-w-0"
    >
      <span className={`relative grid place-items-center shrink-0 w-10 h-10 md:w-12 md:h-12 short:!w-9 short:!h-9 rounded-[14px] bg-gradient-to-b ${TONES[tone]}`}>
        <span aria-hidden="true" className="absolute inset-x-1 top-0.5 h-1/2 rounded-t-[12px] bg-white/30" />
        <Icon name={icon} className="relative w-5 h-5 md:w-6 md:h-6" strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display font-extrabold text-[0.98rem] md:text-lg leading-tight truncate">{title}</span>
        <span className="block text-xs md:text-[0.8rem] text-muted leading-tight truncate">{sub}</span>
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="hidden sm:block w-4 h-4 shrink-0 text-white/30 group-hover:text-sun group-hover:translate-x-0.5 transition-all duration-[var(--duration-fast)]" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5 L16 12 L9 19" />
      </svg>
    </motion.button>
  );
}

function NavButton({ icon, label, screen, testId }: { icon: IconName; label: string; screen: Screen; testId: string }) {
  return (
    <Button size="sm" variant="secondary" testId={testId} onClick={() => go(screen)} title={label} className="!min-h-11 !min-w-11 !px-2.5 lg:!px-3.5">
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
  const avatarSize = Math.round(Math.max(120, Math.min(h * 0.54, w * 0.3, 460)));
  const xpFrac = lvl.need ? lvl.into / lvl.need : 1;

  const play = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      if ((await quickMatchOrOffline()) === 'online') go('lobby');
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
      <header className="flex items-center gap-2 md:gap-3 shrink-0 w-full max-w-[1400px] mx-auto">
        <button
          type="button"
          onClick={() => {
            sfx('ui_click');
            go('profile');
          }}
          className="tile flex items-center gap-2.5 min-h-12 pl-1.5 pr-3.5 py-1.5 rounded-full text-left min-w-0"
          aria-label={t('menu.profileBadge', { name: profile.name || t('name.guest'), n: lvl.level })}
        >
          <span className="relative grid place-items-center w-10 h-10 rounded-full shrink-0 p-[3px]" style={{ background: `conic-gradient(#ffd34d ${Math.round(xpFrac * 360)}deg, rgb(255 255 255 / 0.12) 0)` }}>
            <span className="grid place-items-center w-full h-full rounded-full bg-gradient-to-b from-[#3a2a08] to-[#1a1408] font-display font-extrabold text-sun text-lg leading-none tabular-nums pt-0.5">{lvl.level}</span>
          </span>
          <span className="min-w-0">
            <span className="block font-display font-extrabold leading-tight truncate max-w-[8rem] md:max-w-[14rem]">{profile.name || t('name.guest')}</span>
            <span className="flex items-center gap-2">
              <ProgressBar value={xpFrac} className="!h-1.5 w-20 md:w-32" label={t('profile.xp')} />
              <span className="hidden md:inline text-[0.7rem] font-bold text-muted tabular-nums">{lvl.need ? `${lvl.into}/${lvl.need}` : ''}</span>
            </span>
          </span>
        </button>
        <SparksBadge n={profile.sparks} className="hidden sm:inline-flex" />
        <button
          type="button"
          onClick={() => {
            sfx('ui_click');
            go('profile');
          }}
          className="tile hidden md:inline-flex items-center gap-1.5 min-h-9 px-3 rounded-full text-xs font-extrabold"
          data-testid="daily-chip"
        >
          <Icon name="star" className="w-3.5 h-3.5 text-sun" />
          {t('menu.daily', { n: dailyDone, of: profile.daily.length })}
          <span className="flex gap-0.5 ml-0.5" aria-hidden="true">
            {profile.daily.map((c, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${c.claimed ? 'bg-sun shadow-[0_0_6px_rgb(255_211_77/0.9)]' : 'bg-white/20'}`} />
            ))}
          </span>
        </button>
        <nav className="ml-auto flex gap-1.5 md:gap-2" aria-label={t('menu.nav')}>
          <NavButton icon="shirt" label={t('nav.armoury')} screen="armoury" testId="nav-armoury" />
          <NavButton icon="user" label={t('nav.profile')} screen="profile" testId="nav-profile" />
          <NavButton icon="gear" label={t('nav.settings')} screen="settings" testId="nav-settings" />
          <NavButton icon="star" label={t('nav.credits')} screen="credits" testId="nav-credits" />
        </nav>
      </header>

      <main className="flex-1 min-h-0 w-full max-w-[1400px] mx-auto grid grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-3 md:gap-10 items-center">
        {/* Showcase */}
        <section className="relative flex flex-col items-center justify-center min-h-0 h-full">
          <motion.div
            initial={motionOk ? { opacity: 0, y: -10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative text-center leading-none select-none z-10"
          >
            <div className="font-display font-extrabold text-title text-[clamp(2.6rem,11vh,7.5rem)] tracking-[0.08em] [:root[lang=hi]_&]:tracking-normal [:root[lang=hi]_&]:leading-[1.3]">{t('app.name').toUpperCase()}</div>
            <div className="flex items-center justify-center gap-3 -mt-0.5 md:mt-0 [:root[lang=hi]_&]:mt-1.5">
              <span aria-hidden="true" className="h-px w-6 md:w-12 bg-gradient-to-r from-transparent to-white/60" />
              <span className="font-display font-bold text-white/90 text-[clamp(0.7rem,2.3vh,1.35rem)] tracking-[0.32em] [:root[lang=hi]_&]:tracking-normal uppercase">{t('app.tagline')}</span>
              <span aria-hidden="true" className="h-px w-6 md:w-12 bg-gradient-to-l from-transparent to-white/60" />
            </div>
          </motion.div>
          <button
            type="button"
            onClick={() => {
              sfx('ui_click');
              go('armoury');
            }}
            aria-label={t('nav.armoury')}
            className="group relative rounded-full mt-1 outline-offset-0"
            style={{ width: avatarSize, height: avatarSize }}
          >
            {/* Back light */}
            <span aria-hidden="true" className={`absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 w-[92%] h-[92%] rounded-full ${motionOk ? 'animate-[pulse-glow_3.4s_ease-in-out_infinite]' : ''}`} style={{ background: 'radial-gradient(circle, rgb(255 200 90 / 0.38) 0%, rgb(255 140 80 / 0.14) 40%, transparent 68%)' }} />
            {/* Pedestal */}
            <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 bottom-[6%] w-[66%] h-[15%]">
              <span className="absolute inset-0 rounded-[50%] bg-gradient-to-b from-[#3a3355] to-[#151226] shadow-[0_18px_30px_-8px_rgb(0_0_0/0.8)]" />
              <span className="absolute inset-x-0 top-0 h-[62%] rounded-[50%] bg-gradient-to-b from-[#5a4f80] to-[#2a2444] border border-white/15" />
              <span className="absolute inset-x-[8%] top-[6%] h-[44%] rounded-[50%] border-2 border-sun/70 shadow-[0_0_18px_rgb(255_200_80/0.7),inset_0_0_14px_rgb(255_200_80/0.45)]" />
            </span>
            <motion.span
              className="absolute inset-0 block"
              animate={motionOk ? { y: [0, -9, 0] } : undefined}
              transition={motionOk ? { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } : undefined}
            >
              <Avatar loadout={profile.loadout} size={avatarSize} animate={motionOk} />
            </motion.span>
            <span className="absolute left-1/2 -translate-x-1/2 -bottom-1 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-[var(--duration-base)] glass rounded-full px-3 py-1 text-xs font-extrabold whitespace-nowrap">
              {t('nav.armoury')}
            </span>
          </button>
        </section>

        {/* Play + modes */}
        <section className="flex flex-col gap-2.5 md:gap-4 short:!gap-2 min-h-0 max-h-full overflow-y-auto py-2 px-2 -mx-2">
          <motion.div
            initial={motionOk ? { scale: 0.94, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.34, ease: [0.2, 0.8, 0.2, 1], delay: 0.05 }}
            className="relative"
          >
            <span aria-hidden="true" className="absolute -inset-3 rounded-[28px] bg-[radial-gradient(60%_80%_at_50%_60%,rgb(255_190_60/0.35),transparent_70%)] blur-md" />
            <Button variant="primary" size="xl" testId="play-quick" onClick={play} disabled={connecting} autoFocus={!needName} className={`relative w-full !min-h-16 md:!min-h-[5.5rem] short:!min-h-14 short:!text-[1.75rem] !rounded-[22px] md:!text-[2.6rem] ${motionOk && !connecting ? 'shine' : ''}`}>
              {connecting ? <Spinner className="!w-7 !h-7 !border-black/15 !border-t-[#2a1d00]" /> : <Icon name="play" className="w-8 h-8 md:w-10 md:h-10" />}
              <span className="relative">{connecting ? t('menu.connecting') : t('menu.play')}</span>
            </Button>
            <p className="relative flex items-center justify-center gap-1.5 text-center text-xs md:text-sm text-white/80 mt-2 short:!mt-1 font-bold">
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-mint shadow-[0_0_8px_rgb(140_240_106/0.9)]" />
              {t('menu.playSub')}
            </p>
          </motion.div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 short:!gap-1.5">
            <ModeCard index={0} icon="lock" title={t('menu.private')} sub={t('menu.privateSub')} onClick={() => go('online')} testId="mode-private" tone="sky" />
            <ModeCard index={1} icon="wifi" title={t('menu.lan')} sub={t('menu.lanSub')} onClick={() => go('lan')} testId="mode-lan" tone="mint" />
            <ModeCard index={2} icon="bot" title={t('menu.bots')} sub={t('menu.botsSub')} onClick={() => go('bots')} testId="mode-bots" tone="coral" />
            <ModeCard index={3} icon="waves" title={t('menu.survival')} sub={t('menu.survivalSub')} onClick={() => go('survival')} testId="mode-survival" tone="sun" />
            <ModeCard index={4} icon="target" title={t('menu.training')} sub={t('menu.trainingSub')} onClick={() => go('training')} testId="mode-training" tone="violet" />
            <ModeCard index={5} icon="shirt" title={t('nav.armoury')} sub={t('menu.armourySub')} onClick={() => go('armoury')} testId="mode-armoury" tone="rose" />
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
