import { COSMETICS, WEAPONS } from '@game/content';
import type { PlayerResult } from '@game/sim';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { app, go, leaveSession, rematch } from '../core/app';
import { levelInfo } from '../core/profile';
import { TEAM_COLORS } from '../core/settings';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/icons';
import { lookToLoadout, mapName, modeName, isTeamMode, useTeamColors } from '../components/match';
import { Button, Chip, Page, Panel, ProgressBar, SectionTitle, SparkIcon, useMotionOk } from '../components/ui';

const POSES: Record<string, string> = { pose_salute: 'salute', pose_flex: 'flex', pose_spin: 'spin' };

function weaponName(id: string): string {
  return WEAPONS.find((w) => w.id === id)?.name ?? '—';
}

function LevelBar({ xpAfter, gained, levelBefore, levelAfter }: { xpAfter: number; gained: number; levelBefore: number; levelAfter: number }) {
  const motionOk = useMotionOk();
  const before = levelInfo(Math.max(0, xpAfter - gained));
  const after = levelInfo(xpAfter);
  const frac = (l: { into: number; need: number }) => (l.need ? l.into / l.need : 1);
  const [stage, setStage] = useState(motionOk ? 0 : 2);
  useEffect(() => {
    if (!motionOk) return;
    const a = setTimeout(() => setStage(1), 700);
    const b = setTimeout(() => setStage(2), 1200);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [motionOk]);
  const levelled = levelAfter > levelBefore;
  const value = stage === 0 ? frac(before) : stage === 1 ? (levelled ? 1 : frac(after)) : frac(after);
  const shownLevel = stage < 2 ? levelBefore : levelAfter;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-display font-extrabold text-lg">{t('common.level', { n: shownLevel })}</span>
        <span className="text-muted tabular-nums">{after.need ? `${after.into} / ${after.need} XP` : t('profile.maxLevel')}</span>
      </div>
      <ProgressBar value={value} color="bg-sky" className="!h-4" label={t('profile.xp')} />
    </div>
  );
}

export function Results() {
  const sess = useStore(app, (s) => s.session);
  const reward = useStore(app, (s) => s.reward);
  const profile = useStore(app, (s) => s.profile);
  const cb = useStore(app, (s) => s.settings.accessibility.colorblind);
  const motionOk = useMotionOk();
  const [red, blue] = useTeamColors();
  const results = sess?.results ?? null;

  useEffect(() => {
    if (!results) go('menu');
  }, [results]);
  if (!sess || !results) return null;

  const meId = sess.playerId;
  const me = results.players.find((p) => p.id === meId);
  const teams = isTeamMode(results.mode) && results.mode !== 'survival';
  const survival = results.mode === 'survival';
  const practice = results.mode === 'training' || sess.purpose !== 'match';
  const draw = teams ? results.winnerTeam < 0 : results.winner < 0;
  const won = reward?.won ?? (teams ? results.winnerTeam === me?.team : results.winner === meId);
  const banner = practice ? t('results.practice') : survival ? t('results.waves', { n: Math.max(0, results.wave - 1) }) : draw ? t('hud.draw') : won ? t('hud.victory') : t('hud.defeat');
  const bannerTone = practice || survival ? 'from-[#9be6ff] via-[#5ad1ff] to-[#2b8fd6] text-[#032536] shadow-[0_18px_44px_-16px_rgb(90_209_255/0.6)]' : draw ? 'from-[#4a5272] via-[#353b57] to-[#252a3d] text-text' : won ? 'from-[#fff0a6] via-[#ffd34d] to-[#ff9d2e] text-[#2a1d00] shadow-[0_18px_44px_-16px_rgb(255_190_60/0.7)]' : 'from-[#ffb8a0] via-[#ff7a45] to-[#d9432a] text-[#2e0800] shadow-[0_18px_44px_-16px_rgb(255_110_70/0.6)]';
  const winnerName = teams ? (results.winnerTeam >= 0 ? t(results.winnerTeam === 0 ? 'team.red' : 'team.blue') : '') : results.players.find((p) => p.id === results.winner)?.name ?? '';

  const mvp = results.players.find((p) => p.id === results.mvp);
  const mvpLook = mvp ? (mvp.id === meId ? profile.loadout : lookToLoadout(sess.lobby?.players.find((p) => p.id === mvp.id)?.look)) : null;
  const sorted = [...results.players].sort((a, b) => (teams ? a.team - b.team : 0) || b.score - a.score || b.kills - a.kills);
  const unlocked = reward && reward.levelAfter > reward.levelBefore ? COSMETICS.filter((c) => c.unlockLevel > reward.levelBefore && c.unlockLevel <= reward.levelAfter) : [];
  const privateGuest = sess.kind !== 'offline' && !sess.lobby?.quickMatch && !sess.isHost;
  const againLabel = privateGuest ? t('results.toLobby') : t('results.again');
  const fadeUp = (i: number) => (motionOk ? { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.25 + i * 0.12, duration: 0.24 } } : {});

  const row = (p: PlayerResult) => (
    <tr key={p.id} className={`border-t border-white/[0.06] ${p.id === meId ? 'text-sun font-bold bg-sun/[0.06]' : ''}`}>
      <td className="py-1.5 pr-2 max-w-[10rem]">
        <span className="flex items-center gap-1.5 min-w-0">
          {teams && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.team === 0 ? red : blue, boxShadow: `0 0 8px ${p.team === 0 ? red : blue}` }} />}
          <span className="truncate">{p.name}</span>
          {p.id === results.mvp && <Chip color="bg-sun text-ink">MVP</Chip>}
          {p.isBot && <span className="text-muted text-xs font-normal">({t('common.bot')})</span>}
        </span>
      </td>
      <td className="tabular-nums text-right px-1.5">{p.score}</td>
      <td className="tabular-nums text-right px-1.5">{p.kills}</td>
      <td className="tabular-nums text-right px-1.5">{p.deaths}</td>
      <td className="tabular-nums text-right px-1.5">{p.assists}</td>
      <td className="tabular-nums text-right px-1.5 hidden sm:table-cell">{Math.round(p.accuracy * 100)}%</td>
      <td className="tabular-nums text-right px-1.5 hidden md:table-cell">{p.headshots}</td>
      <td className="tabular-nums text-right px-1.5 hidden md:table-cell">{Math.round(p.damage)}</td>
      <td className="pl-1.5 hidden lg:table-cell truncate">{weaponName(p.favouriteWeapon)}</td>
    </tr>
  );

  return (
    <Page
      title={t('results.title')}
      back={leaveSession}
      testId="results"
      actions={
        <>
          <Button variant="secondary" size="sm" sound="ui_back" testId="results-menu" onClick={leaveSession} className="!min-h-11">
            {t('results.menu')}
          </Button>
          <Button variant="primary" size="sm" testId="results-again" autoFocus onClick={() => void rematch()} className="!min-h-11">
            <Icon name="refresh" className="w-4 h-4" />
            {againLabel}
          </Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-3 md:gap-4">
        <div className="flex flex-col gap-3 min-w-0">
          <motion.div
            initial={motionOk ? { scale: 0.85, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            className={`relative overflow-hidden rounded-[var(--radius-xl)] bg-gradient-to-br border border-white/30 px-5 py-4 ${bannerTone}`}
          >
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
            <span aria-hidden="true" className="absolute -right-6 -top-10 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
            <div className="relative font-display font-extrabold text-4xl md:text-6xl leading-none uppercase tracking-wide [:root[lang=hi]_&]:tracking-normal [:root[lang=hi]_&]:leading-[1.25]">{banner}</div>
            <div className="relative text-sm font-bold opacity-80 mt-1.5">
              {modeName(results.mode)} · {mapName(results.mapId)}
              {!practice && !survival && winnerName && ` · ${t('results.winner', { name: winnerName })}`}
            </div>
            {teams && (
              <div className="relative flex items-center gap-3 mt-2.5 font-display font-extrabold text-2xl tabular-nums">
                <span className="min-w-12 text-center px-3 py-0.5 rounded-[12px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_12px_rgb(0_0_0/0.3)]" style={{ background: red }}>{results.teamScores[0]}</span>
                <span className="text-base">{t('results.vs')}</span>
                <span className="min-w-12 text-center px-3 py-0.5 rounded-[12px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_12px_rgb(0_0_0/0.3)]" style={{ background: blue }}>{results.teamScores[1]}</span>
              </div>
            )}
          </motion.div>

          {mvp && mvpLook && (
            <motion.div {...fadeUp(0)}>
              <Panel className="flex items-center gap-3 p-3">
                <Avatar loadout={mvpLook} pose={POSES[mvpLook.pose] ?? 'salute'} size={96} team={teams ? mvp.team : -1} teamColor={TEAM_COLORS[cb][mvp.team === 1 ? 1 : 0]} animate={motionOk} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-sun uppercase tracking-wider [:root[lang=hi]_&]:tracking-normal">
                    <Icon name="trophy" className="w-4 h-4" />
                    {t('results.mvp')}
                  </div>
                  <div className="font-display font-extrabold text-xl truncate">{mvp.name}</div>
                  <div className="text-sm text-muted">{t('results.mvpLine', { k: mvp.kills, d: mvp.deaths, s: mvp.score })}</div>
                </div>
              </Panel>
            </motion.div>
          )}

          {reward && !practice && (
            <motion.div {...fadeUp(1)}>
              <Panel className="p-3 flex flex-col gap-2">
                <SectionTitle className="!px-0 !mb-0">{t('results.rewards')}</SectionTitle>
                <ul className="text-sm">
                  {reward.breakdown.map((b, i) => (
                    <motion.li key={b.label} {...fadeUp(i + 2)} className="flex justify-between py-0.5">
                      <span>{t(b.label)}</span>
                      <span className="font-bold text-sky tabular-nums">+{b.xp} XP</span>
                    </motion.li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t border-white/10 pt-2 font-display font-extrabold text-lg">
                  <span>{t('results.total')}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-sky">+{reward.xp} XP</span>
                    <span className="flex items-center gap-1 text-sun">
                      <SparkIcon />+{reward.sparks}
                    </span>
                  </span>
                </div>
                <LevelBar xpAfter={profile.xp} gained={reward.xp} levelBefore={reward.levelBefore} levelAfter={reward.levelAfter} />
                {reward.levelAfter > reward.levelBefore && (
                  <motion.div
                    initial={motionOk ? { scale: 0.6, opacity: 0 } : false}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: motionOk ? 1.25 : 0, type: 'spring', stiffness: 320, damping: 14 }}
                    className="relative overflow-hidden rounded-[18px] bg-gradient-to-br from-[#fff0a6] via-[#ffd34d] to-[#ff9d2e] text-[#2a1d00] p-3 shadow-[0_14px_34px_-12px_rgb(255_190_60/0.7)] border border-white/40"
                    data-testid="level-up"
                  >
                    <div className="font-display font-extrabold text-2xl leading-none">{t('results.levelUp', { n: reward.levelAfter })}</div>
                    {unlocked.length > 0 && (
                      <div className="text-sm font-bold mt-1">
                        {t('results.unlocked')}: {unlocked.map((c) => t(`cos.${c.id}`)).join(', ')}
                      </div>
                    )}
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => go('armoury')}>
                      {t('results.toArmoury')}
                    </Button>
                  </motion.div>
                )}
                {reward.completedChallenges.length > 0 && (
                  <div>
                    <div className="text-xs font-extrabold text-mint uppercase tracking-wider [:root[lang=hi]_&]:tracking-normal mt-1">{t('results.challenges')}</div>
                    <ul className="text-sm">
                      {reward.completedChallenges.map((c) => (
                        <li key={c.id} className="flex justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            <Icon name="check" className="w-4 h-4 text-mint" strokeWidth={3} />
                            {t(`challenge.${c.kind}`, { n: c.target, weapon: weaponName(c.param) })}
                          </span>
                          <span className="font-bold text-sun tabular-nums">+{c.reward}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            </motion.div>
          )}
          {practice && <p className="text-sm text-muted px-1">{t('results.practiceBody')}</p>}
        </div>

        <motion.div {...fadeUp(1)} className="min-w-0">
          <Panel className="p-3 overflow-x-auto">
            <SectionTitle className="!px-0">{t('game.scoreboard')}</SectionTitle>
            <table className="w-full text-sm text-left">
              <thead className="eyebrow !text-[0.65rem]">
                <tr>
                  <th className="py-1 font-bold">{t('game.player')}</th>
                  <th className="text-right px-1.5 font-bold">{t('stats.score')}</th>
                  <th className="text-right px-1.5 font-bold" title={t('stats.kills')}>{t('stats.k')}</th>
                  <th className="text-right px-1.5 font-bold" title={t('stats.deaths')}>{t('stats.d')}</th>
                  <th className="text-right px-1.5 font-bold" title={t('stats.assists')}>{t('stats.a')}</th>
                  <th className="text-right px-1.5 font-bold hidden sm:table-cell">{t('stats.accuracy')}</th>
                  <th className="text-right px-1.5 font-bold hidden md:table-cell">{t('stats.headshots')}</th>
                  <th className="text-right px-1.5 font-bold hidden md:table-cell">{t('stats.damage')}</th>
                  <th className="pl-1.5 font-bold hidden lg:table-cell">{t('stats.favourite')}</th>
                </tr>
              </thead>
              <tbody>{sorted.map(row)}</tbody>
            </table>
          </Panel>
        </motion.div>
      </div>
    </Page>
  );
}
