import { useEffect, useRef, useState } from 'react';
import { EMOTE_COUNT, QUICK_CHAT } from '@game/content';
import { SIGNAL_CHAT, SIGNAL_EMOTE } from '@game/sim';
import { haptic, isTouchDevice } from '@game/platform';
import type { GameHandle } from '@game/client';
import { app, currentClient, leaveSession, reportPlayer, setPaused, toast, updateProfile, updateSettings } from '../core/app';
import { TEAM_COLORS, type Settings } from '../core/settings';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Button, Modal, Toggle, sfx } from '../components/ui';

function clientSettings(s: Settings) {
  return {
    graphics: s.graphics,
    accessibility: s.accessibility,
    controls: { ...s.controls, layouts: s.controls.layouts as unknown as Record<string, { x: number; y: number; size: number; opacity: number; visible: boolean }>[] },
    network: s.network,
    audio: s.audio,
  };
}

/** Hosts the Phaser canvas and the in-match overlays (pause, scoreboard, emotes). */
export function GameScreen() {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<GameHandle | null>(null);
  const [pause, setPause] = useState(false);
  const [board, setBoard] = useState(false);
  const [wheel, setWheel] = useState(false);
  const [tutDone, setTutDone] = useState(false);
  const [error, setError] = useState('');
  const settings = useStore(app, (s) => s.settings);
  const session = useStore(app, (s) => s.session);
  const overlay = useStore(app, (s) => s.overlay);

  useEffect(() => {
    const client = currentClient();
    const el = ref.current;
    if (!client || !el) return;
    let disposed = false;
    import('@game/client')
      .then(({ mountGame }) => {
        if (disposed) return;
        const s = app.get().settings;
        handle.current = mountGame(el, {
          client,
          settings: () => clientSettings(app.get().settings),
          teamColors: TEAM_COLORS[s.accessibility.colorblind],
          isTouch: isTouchDevice(),
          tutorial: app.get().session?.purpose === 'tutorial',
          callbacks: {
            onPause: () => setPause((p) => !p),
            onScoreboard: (show) => setBoard(show),
            onEmoteWheel: () => setWheel((w) => !w),
            haptic: (k) => void haptic(k),
            t: (k, v) => t(k, v),
            onTutorialDone: () => {
              updateProfile((p) => ({ ...p, tutorialDone: true }));
              setTimeout(() => setTutDone(true), 1200);
            },
          },
        });
      })
      .catch((e) => {
        console.error(e);
        setError(String(e?.message ?? e));
      });
    return () => {
      disposed = true;
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);

  useEffect(() => {
    handle.current?.setSettings(clientSettings(settings));
  }, [settings]);

  useEffect(() => {
    setPaused(pause);
    return () => setPaused(false);
  }, [pause]);

  // Android back / Escape from the app shell opens the pause menu.
  useEffect(() => {
    if (overlay === 'pause') {
      setPause(true);
      app.set({ overlay: null });
    }
  }, [overlay]);

  const client = currentClient();
  const view = board && client ? client.view() : null;
  const muted = useStore(app, (s) => s.profile.muted);
  const players = view ? [...view.players].filter((p) => !p.dummy && !(p.drone && !p.alive)).sort((a, b) => (a.team - b.team) || b.score - a.score || b.kills - a.kills) : [];
  const teams = session?.config && ['tdm', 'ctf', 'leader', 'koth'].includes(session.config.mode);

  return (
    <div className="absolute inset-0" data-testid="game-screen">
      <div ref={ref} className="absolute inset-0" style={{ touchAction: 'none' }} data-testid="game-canvas" />
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-night/90 safe">
          <div className="glass rounded-[var(--radius-xl)] p-6 text-center max-w-md">
            <p className="mb-4 text-coral font-bold">{t('error.render')}</p>
            <Button onClick={leaveSession}>{t('common.back')}</Button>
          </div>
        </div>
      )}
      {session?.reconnecting && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-full glass font-bold" role="status" data-testid="reconnecting">
          <span aria-hidden="true" className="inline-block w-4 h-4 rounded-full border-2 border-white/20 border-t-coral animate-spin" />
          {t('game.reconnecting')}
        </div>
      )}
      <Modal open={pause} onClose={() => setPause(false)} title={t('game.paused')} testId="pause-menu">
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={() => setPause(false)} testId="resume" autoFocus>
            {t('game.resume')}
          </Button>
          <Toggle label={t('settings.sound')} value={settings.audio.master > 0} onChange={(v) => updateSettings((s) => ({ ...s, audio: { ...s.audio, master: v ? 0.8 : 0 } }))} />
          <Toggle label={t('settings.shake')} value={settings.graphics.shake} onChange={(v) => updateSettings((s) => ({ ...s, graphics: { ...s.graphics, shake: v } }))} />
          <Toggle label={t('settings.netStats')} value={settings.network.showNetStats} onChange={(v) => updateSettings((s) => ({ ...s, network: { ...s.network, showNetStats: v } }))} />
          {session?.kind !== 'offline' && <p className="text-muted text-sm px-3">{t('game.pauseOnline')}</p>}
          <Button variant="danger" onClick={() => leaveSession()} testId="leave-match">
            {t('game.leave')}
          </Button>
        </div>
      </Modal>
      {board && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-[#05060c]/65 pointer-events-auto safe" onClick={() => setBoard(false)} data-testid="scoreboard">
          <div className="glass !bg-[linear-gradient(180deg,rgb(40_45_70/0.94),rgb(20_23_36/0.96))] rounded-[var(--radius-xl)] p-4 md:p-5 w-[min(94vw,760px)] max-h-[86vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display font-extrabold text-2xl text-title mb-2">{t('game.scoreboard')}</h2>
            <table className="w-full text-left text-sm">
              <thead className="eyebrow !text-[0.65rem]">
                <tr>
                  <th className="py-1">{t('game.player')}</th>
                  <th>{t('stats.score')}</th>
                  <th>{t('stats.kills')}</th>
                  <th>{t('stats.deaths')}</th>
                  <th>{t('stats.assists')}</th>
                  <th>{t('game.ping')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const name = client!.playerName(p.id);
                  const lobbyP = session?.lobby?.players.find((x) => x.id === p.id);
                  const me = p.id === session?.playerId;
                  return (
                    <tr key={p.id} className={`border-t border-white/[0.06] tabular-nums ${me ? 'text-sun font-bold bg-sun/[0.06]' : ''}`}>
                      <td className="py-1.5">
                        {teams && <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 shadow-[0_0_6px_currentColor]" style={{ background: p.team === 0 ? 'var(--color-red-team)' : 'var(--color-blue-team)' }} />}
                        {name} {p.isBot && <span className="text-muted text-xs">({t('common.bot')})</span>}
                      </td>
                      <td>{p.score}</td>
                      <td>{p.kills}</td>
                      <td>{p.deaths}</td>
                      <td>{p.assists}</td>
                      <td className="text-muted">{p.isBot ? '—' : lobbyP?.ping ?? '—'}</td>
                      <td className="text-right whitespace-nowrap">
                        {!me && !p.isBot && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                updateProfile((pr) => ({ ...pr, muted: pr.muted.includes(name) ? pr.muted.filter((m) => m !== name) : [...pr.muted, name] }))
                              }
                            >
                              {muted.includes(name) ? t('game.unmute') : t('game.mute')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                void reportPlayer(name, 'other');
                                toast('game.reported', 'success');
                              }}
                            >
                              {t('game.report')}
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Modal open={wheel} onClose={() => setWheel(false)} title={t('game.emotes')} testId="emote-wheel">
        <div className="grid grid-cols-3 gap-2.5 mb-3">
          {Array.from({ length: EMOTE_COUNT }, (_, i) => (
            <Button
              key={i}
              size="lg"
              onClick={() => {
                handle.current?.signal(SIGNAL_EMOTE + i + 1);
                setWheel(false);
              }}
            >
              {['👋', '😂', 'GG', '😠', '❤', '😎'][i]}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_CHAT.map((k, i) => (
            <Button
              key={k}
              size="sm"
              onClick={() => {
                handle.current?.signal(SIGNAL_CHAT + i);
                setWheel(false);
                sfx('ui_click');
              }}
            >
              {t(k)}
            </Button>
          ))}
        </div>
      </Modal>
      <Modal open={tutDone} title={t('tut.completeTitle')} testId="tutorial-done">
        <p className="mb-4 text-text">{t('tut.completeBody')}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={() => setTutDone(false)}>
            {t('tut.keepPracticing')}
          </Button>
          <Button variant="primary" onClick={() => leaveSession()} testId="tutorial-finish">
            {t('common.continue')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
