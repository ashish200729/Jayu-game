import { MODES, TICK_RATE, WEAPONS } from '@game/content';
import { sanitizeName } from '@game/net';
import { useState } from 'react';
import { app, toast, updateProfile } from '../core/app';
import { favouriteWeapon, levelInfo, type ChallengeState } from '../core/profile';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Avatar } from '../components/Avatar';
import { AccountPanel } from '../components/account';
import { Icon } from '../components/icons';
import { Button, Page, Panel, ProgressBar, SectionTitle, SparkIcon, SparksBadge, Tabs, TextInput, useMotionOk } from '../components/ui';
import { nameError } from './MainMenu';

type Tab = 'stats' | 'challenges' | 'account';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-night/40 border-2 border-ink px-3 py-2 min-w-0">
      <div className="text-xs text-muted font-bold truncate">{label}</div>
      <div className="font-display font-extrabold text-xl tabular-nums truncate">{value}</div>
    </div>
  );
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? t('profile.hm', { h, m }) : t('profile.m', { m });
}

function weaponName(id: string): string {
  return WEAPONS.find((w) => w.id === id)?.name ?? id;
}

export function challengeText(c: ChallengeState): string {
  return t(`challenge.${c.kind}`, { n: c.target, weapon: weaponName(c.param) });
}

function Challenge({ c }: { c: ChallengeState }) {
  return (
    <li className={`rounded-md border-2 border-ink p-2.5 ${c.claimed ? 'bg-mint/10' : 'bg-night/40'}`}>
      <div className="flex items-start gap-2">
        <span className={`grid place-items-center w-6 h-6 rounded-full border-2 border-ink shrink-0 ${c.claimed ? 'bg-mint text-ink' : 'bg-panel-2 text-muted'}`}>
          {c.claimed ? <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} /> : <Icon name="target" className="w-3.5 h-3.5" />}
        </span>
        <span className="flex-1 text-sm font-bold leading-snug">{challengeText(c)}</span>
        <span className="flex items-center gap-1 text-sm font-extrabold text-sun tabular-nums shrink-0">
          <SparkIcon className="w-3.5 h-3.5" />
          {c.reward}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <ProgressBar value={c.progress / c.target} color={c.claimed ? 'bg-mint' : 'bg-sun'} className="flex-1 !h-2.5" label={challengeText(c)} />
        <span className="text-xs text-muted tabular-nums w-14 text-right">
          {c.progress}/{c.target}
        </span>
      </div>
    </li>
  );
}

function hoursUntil(next: Date): number {
  return Math.max(1, Math.ceil((next.getTime() - Date.now()) / 3600000));
}

export function Profile() {
  const profile = useStore(app, (s) => s.profile);
  const motionOk = useMotionOk();
  const [tab, setTab] = useState<Tab>('stats');
  const [name, setName] = useState(profile.name);
  const [err, setErr] = useState('');
  const lvl = levelInfo(profile.xp);
  const s = profile.stats;
  const fav = favouriteWeapon(s);
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
  const acc = s.shotsFired ? `${Math.round((s.shotsHit / s.shotsFired) * 100)}%` : '—';
  const changed = name.trim() !== profile.name;

  const saveName = () => {
    const e = nameError(name);
    setErr(e);
    if (e) return;
    const clean = sanitizeName(name);
    updateProfile((p) => ({ ...p, name: clean, syncVersion: p.syncVersion + 1 }));
    setName(clean);
    toast('profile.nameSaved', 'success');
  };

  const now = new Date();
  const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const nextWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (7 - ((now.getUTCDay() + 6) % 7))));
  const played = MODES.filter((m) => (s.modePlayed[m.id] ?? 0) > 0);

  return (
    <Page title={t('nav.profile')} testId="profile" actions={<SparksBadge n={profile.sparks} />}>
      <div className="flex flex-col gap-3">
        <Panel className="p-3 flex flex-wrap items-center gap-3 md:gap-5">
          <Avatar loadout={profile.loadout} size={84} animate={motionOk} />
          <div className="flex-1 min-w-[14rem]">
            <div className="flex gap-2 items-end">
              <TextInput
                className="flex-1"
                label={t('name.label')}
                value={name}
                maxLength={16}
                testId="profile-name"
                invalid={!!err}
                onChange={(v) => {
                  setName(v);
                  if (err) setErr('');
                }}
                onEnter={saveName}
              />
              <Button variant="primary" disabled={!changed} onClick={saveName} testId="profile-name-save" className="!min-h-12">
                {t('common.save')}
              </Button>
            </div>
            <p className={`text-xs mt-1 min-h-4 ${err ? 'text-danger font-bold' : 'text-muted'}`} role={err ? 'alert' : undefined}>
              {err ? t(err) : t('name.hint')}
            </p>
          </div>
          <div className="w-full sm:w-64">
            <div className="flex justify-between items-baseline">
              <span className="font-display font-extrabold text-2xl">{t('common.level', { n: lvl.level })}</span>
              <span className="text-xs text-muted tabular-nums">{lvl.need ? `${lvl.into} / ${lvl.need} XP` : t('profile.maxLevel')}</span>
            </div>
            <ProgressBar value={lvl.need ? lvl.into / lvl.need : 1} color="bg-sky" className="!h-4 mt-1" label={t('profile.xp')} />
            <div className="text-xs text-muted mt-1">{t('profile.totalXp', { n: profile.xp.toLocaleString() })}</div>
          </div>
        </Panel>

        <Tabs
          value={tab}
          onChange={setTab}
          testIdPrefix="profile-tab-"
          options={[
            { value: 'stats', label: t('profile.stats') },
            { value: 'challenges', label: t('profile.challenges') },
            { value: 'account', label: t('account.title') },
          ]}
        />

        {tab === 'stats' && (
          <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
              <Stat label={t('profile.matches')} value={s.matches} />
              <Stat label={t('profile.wins')} value={s.wins} />
              <Stat label={t('profile.kd')} value={kd} />
              <Stat label={t('stats.kills')} value={s.kills} />
              <Stat label={t('stats.deaths')} value={s.deaths} />
              <Stat label={t('stats.assists')} value={s.assists} />
              <Stat label={t('stats.accuracy')} value={acc} />
              <Stat label={t('stats.headshots')} value={s.headshots} />
              <Stat label={t('stats.damage')} value={Math.round(s.damage).toLocaleString()} />
              <Stat label={t('profile.playTime')} value={formatTime(s.playTimeSec)} />
              <Stat label={t('stats.favourite')} value={fav ? weaponName(fav) : '—'} />
              <Stat label={t('profile.bestWave')} value={s.bestWave || '—'} />
              <Stat label={t('profile.bestCourse')} value={s.bestCourseTicks ? `${(s.bestCourseTicks / TICK_RATE).toFixed(2)}s` : '—'} />
            </div>
            <Panel className="p-3">
              <SectionTitle className="!px-0">{t('profile.byMode')}</SectionTitle>
              {played.length === 0 ? (
                <p className="text-sm text-muted">{t('profile.noMatches')}</p>
              ) : (
                <ul className="text-sm flex flex-col gap-1">
                  {played.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span>{t(`mode.${m.id}`)}</span>
                      <span className="tabular-nums text-muted">{t('profile.winsOf', { w: s.modeWins[m.id] ?? 0, n: s.modePlayed[m.id] ?? 0 })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}

        {tab === 'challenges' && (
          <div className="grid md:grid-cols-2 gap-3">
            <Panel className="p-3">
              <div className="flex items-baseline justify-between">
                <SectionTitle className="!px-0">{t('profile.daily')}</SectionTitle>
                <span className="text-xs text-muted">{t('profile.resetsIn', { n: hoursUntil(nextDay) })}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {profile.daily.map((c) => (
                  <Challenge key={c.id} c={c} />
                ))}
              </ul>
            </Panel>
            <Panel className="p-3">
              <div className="flex items-baseline justify-between">
                <SectionTitle className="!px-0">{t('profile.weekly')}</SectionTitle>
                <span className="text-xs text-muted">{t('profile.resetsInDays', { n: Math.ceil(hoursUntil(nextWeek) / 24) })}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {profile.weekly.map((c) => (
                  <Challenge key={c.id} c={c} />
                ))}
              </ul>
            </Panel>
          </div>
        )}

        {tab === 'account' && <AccountPanel />}
      </div>
    </Page>
  );
}
