import { MODES } from '@game/content';
import type { LobbyPlayer, LobbyStateMsg } from '@game/net';
import { copyText, isNative, shareInvite } from '@game/platform';
import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { app, go, leaveSession, lobbyAction, toast, type SessionSnapshot } from '../core/app';
import { TEAM_COLORS } from '../core/settings';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/icons';
import { CrownIcon, MatchSettingsForm, PlatformIcon, isTeamMode, lookToLoadout, mapName, modeName, pickableModes, useTeamColors } from '../components/match';
import { Button, Chip, Modal, Page, Panel, SectionTitle, Spinner, useMotionOk } from '../components/ui';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function inviteUrl(code: string): string {
  if (!isNative && typeof location !== 'undefined') return `${location.origin}${location.pathname}?join=${code}`;
  return env.VITE_PUBLIC_URL ? `${env.VITE_PUBLIC_URL.replace(/\/$/, '')}/?join=${code}` : '';
}

function PlayerRow({ p, me, hostId, canKick, teams }: { p: LobbyPlayer; me: boolean; hostId: number; canKick: boolean; teams: boolean }) {
  const cb = useStore(app, (s) => s.settings.accessibility.colorblind);
  const [red, blue] = useTeamColors();
  const teamCol = teams && p.team >= 0 ? (p.team === 0 ? red : blue) : 'transparent';
  return (
    <li className={`well flex items-center gap-2.5 pr-2.5 rounded-[16px] overflow-hidden ${me ? '!bg-sun/[0.07] !border-sun/30' : ''} ${p.connected ? '' : 'opacity-50'}`} data-testid={`slot-${p.id}`}>
      <span className="self-stretch w-1 shrink-0" style={{ background: teamCol, boxShadow: teams ? `0 0 12px ${teamCol}` : undefined }} aria-hidden="true" />
      <span className="shrink-0 -my-1">
        <Avatar loadout={lookToLoadout(p.look)} size={52} animate={false} team={teams ? p.team : -1} teamColor={TEAM_COLORS[cb][p.team === 1 ? 1 : 0]} />
      </span>
      <span className="flex-1 min-w-0 py-1">
        <span className="flex items-center gap-1.5 min-w-0">
          {p.id === hostId && <CrownIcon className="w-5 h-4 shrink-0" />}
          <span className={`font-bold truncate ${me ? 'text-sun' : ''}`}>{p.name}</span>
          {me && <Chip color="bg-sun text-ink">{t('common.you')}</Chip>}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          <PlatformIcon platform={p.isBot ? 'bot' : p.platform} />
          {!p.isBot && <span className="tabular-nums">{p.ping > 0 ? t('online.ms', { n: p.ping }) : '—'}</span>}
        </span>
      </span>
      {p.isBot ? (
        <Chip>{t('common.bot')}</Chip>
      ) : (
        <span className={`inline-flex items-center gap-1 text-xs font-extrabold px-2.5 py-1 rounded-full ${p.ready ? 'bg-gradient-to-b from-[#c4ffa6] to-[#5fd64a] text-[#0d2a06] shadow-[0_0_12px_-2px_rgb(140_240_106/0.7)]' : 'bg-white/[0.07] text-muted'}`}>
          {p.ready && <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />}
          {p.ready ? t('common.ready') : t('common.notReady')}
        </span>
      )}
      {canKick && !me && !p.isBot && (
        <Button size="sm" variant="ghost" onClick={() => lobbyAction({ a: 'kick', id: p.id })} title={t('lobby.kick', { name: p.name })} className="!min-h-10 !px-2">
          <Icon name="x" className="w-4 h-4" />
          <span className="sr-only">{t('lobby.kick', { name: p.name })}</span>
        </Button>
      )}
    </li>
  );
}

function Players({ lobby, sess }: { lobby: LobbyStateMsg; sess: SessionSnapshot }) {
  const teams = isTeamMode(lobby.settings.mode) && lobby.settings.mode !== 'survival';
  const canKick = sess.isHost && !lobby.quickMatch;
  const [red, blue] = useTeamColors();
  const me = lobby.players.find((p) => p.id === sess.playerId);
  const row = (p: LobbyPlayer) => <PlayerRow key={p.id} p={p} me={p.id === sess.playerId} hostId={lobby.quickMatch ? -1 : lobby.hostId} canKick={canKick} teams={teams} />;
  if (!teams) {
    return (
      <Panel className="p-3">
        <SectionTitle className="!px-0">{t('lobby.players', { n: lobby.players.length, max: lobby.settings.maxPlayers })}</SectionTitle>
        <ul className="grid xl:grid-cols-2 gap-2">{lobby.players.map(row)}</ul>
      </Panel>
    );
  }
  return (
    <div className="grid lg:grid-cols-2 gap-3">
      {[0, 1].map((team) => {
        const list = lobby.players.filter((p) => (team === 0 ? p.team !== 1 : p.team === 1));
        return (
          <Panel key={team} className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-4 h-4 rounded-full border-2 border-white/30" style={{ background: team === 0 ? red : blue, boxShadow: `0 0 14px ${team === 0 ? red : blue}` }} />
              <h3 className="font-display font-extrabold text-lg flex-1">{t(team === 0 ? 'team.red' : 'team.blue')}</h3>
              {me && me.team !== team && lobby.phase === 'lobby' && (
                <Button size="sm" variant="secondary" onClick={() => lobbyAction({ a: 'team', team })} testId={`lobby-team-${team}`}>
                  {t('lobby.switch')}
                </Button>
              )}
            </div>
            <ul className="flex flex-col gap-2">{list.map(row)}</ul>
            {list.length === 0 && <p className="text-sm text-muted">{t('lobby.emptyTeam')}</p>}
          </Panel>
        );
      })}
    </div>
  );
}

function SettingsSummary({ lobby }: { lobby: LobbyStateMsg }) {
  const s = lobby.settings;
  const def = MODES.find((m) => m.id === s.mode);
  const rows: [string, string][] = [
    [t('setup.map'), mapName(s.mapId)],
    [t('setup.mode'), modeName(s.mode)],
  ];
  if (s.mode !== 'survival') rows.push([t('setup.time'), t('setup.minutes', { n: Math.round(s.timeLimit / 60) })]);
  if (s.mode !== 'survival' && s.mode !== 'bomb') rows.push([t('setup.score'), String(s.scoreLimit || def?.defaultScoreLimit || '—')]);
  rows.push([t('setup.bots'), `${s.botCount} · ${t(['setup.easy', 'setup.normal', 'setup.hard'][s.botDifficulty])}`]);
  const flags = [s.friendlyFire && t('setup.friendlyFire'), s.lowGravity && t('setup.lowGravity'), !s.pickups && t('setup.noPickups')].filter(Boolean) as string[];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="font-bold truncate">{v}</dd>
        </div>
      ))}
      {flags.length > 0 && (
        <dd className="col-span-2 flex flex-wrap gap-1 mt-1">
          {flags.map((f) => (
            <Chip key={f}>{f}</Chip>
          ))}
        </dd>
      )}
    </dl>
  );
}

function InviteCard({ code }: { code: string }) {
  const copy = async () => {
    const ok = (await copyText(code)) === 'copied';
    toast(ok ? 'common.copied' : 'lobby.copyFailed', ok ? 'success' : 'error');
  };
  const share = async () => {
    const r = await shareInvite(code, inviteUrl(code));
    if (r === 'copied') toast('lobby.linkCopied', 'success');
    else if (r === 'failed') toast('lobby.copyFailed', 'error');
  };
  return (
    <Panel className="p-3">
      <div className="eyebrow">{t('lobby.code')}</div>
      <div className="well-sunken rounded-[14px] mt-1.5 px-3 py-1 font-mono font-extrabold text-4xl md:text-5xl tracking-[0.2em] text-sun select-text [user-select:text] leading-tight [text-shadow:0_0_18px_rgb(255_200_70/0.45)]" data-testid="lobby-code">
        {code}
      </div>
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={copy} testId="lobby-copy">
          <Icon name="copy" className="w-4 h-4" />
          {t('common.copy')}
        </Button>
        <Button size="sm" onClick={share} testId="lobby-share">
          <Icon name="share" className="w-4 h-4" />
          {t('common.share')}
        </Button>
      </div>
      <p className="text-xs text-muted mt-2">{t('lobby.inviteHint')}</p>
    </Panel>
  );
}

function StatusCard({ lobby }: { lobby: LobbyStateMsg }) {
  const motionOk = useMotionOk();
  if (lobby.phase === 'starting') {
    return (
      <Panel className="p-3 text-center !bg-[linear-gradient(180deg,rgb(255_211_77/0.18),rgb(30_26_40/0.9))] !border-sun/30">
        <div className="text-sm font-bold text-muted">{t('lobby.starting')}</div>
        <motion.div key={Math.ceil(lobby.countdown)} initial={motionOk ? { scale: 1.5, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} className="font-display font-extrabold text-6xl text-title" data-testid="lobby-countdown">
          {Math.max(0, Math.ceil(lobby.countdown))}
        </motion.div>
      </Panel>
    );
  }
  if (lobby.phase === 'results') {
    return (
      <Panel className="p-3 flex items-center gap-3">
        <Spinner className="!w-6 !h-6" />
        <span className="text-sm font-bold">{t('lobby.waitRematch')}</span>
      </Panel>
    );
  }
  if (lobby.quickMatch) {
    return (
      <Panel className="p-3 flex items-center gap-3">
        <Spinner className="!w-6 !h-6 shrink-0" />
        <div>
          <div className="font-bold">{t('lobby.finding')}</div>
          <div className="text-sm text-muted">{lobby.fillIn > 0 ? t('lobby.botsIn', { n: Math.ceil(lobby.fillIn) }) : t('lobby.botsJoining')}</div>
        </div>
      </Panel>
    );
  }
  return null;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center h-full p-4">{children}</div>;
}

export function Lobby() {
  const sess = useStore(app, (s) => s.session);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!sess) go('menu');
  }, [sess]);

  if (!sess) return null;
  const lobby = sess.lobby;
  const title = sess.kind === 'lan-host' || sess.kind === 'lan-join' ? t('lobby.lanTitle') : lobby?.quickMatch ? t('lobby.quickTitle') : t('lobby.privateTitle');
  const leave = (
    <Button variant="danger" size="sm" sound="ui_back" testId="lobby-leave" onClick={leaveSession} className="!min-h-11">
      {t('lobby.leave')}
    </Button>
  );

  if ((sess.status === 'rejected' || sess.status === 'closed') && !sess.reconnecting) {
    return (
      <Page title={title} back={leaveSession} testId="lobby">
        <Centered>
          <Panel className="p-5 max-w-md text-center flex flex-col items-center gap-3">
            <h2 className="font-display font-extrabold text-2xl text-coral">{t(sess.error || 'error.disconnected')}</h2>
            <p className="text-muted text-sm">{t('lobby.errorBody')}</p>
            <Button variant="primary" autoFocus onClick={leaveSession} testId="lobby-error-back">
              {t('common.back')}
            </Button>
          </Panel>
        </Centered>
      </Page>
    );
  }

  if (sess.status === 'connecting' || !lobby || sess.reconnecting) {
    return (
      <Page title={title} back={leaveSession} testId="lobby" actions={leave}>
        <Centered>
          <div className="flex flex-col items-center gap-3" role="status">
            <Spinner className="!w-12 !h-12" />
            <p className="font-bold">{sess.reconnecting ? t('game.reconnecting') : t('menu.connecting')}</p>
          </div>
        </Centered>
      </Page>
    );
  }

  const me = lobby.players.find((p) => p.id === sess.playerId);
  const hostControls = sess.isHost && !lobby.quickMatch;
  const humans = lobby.players.filter((p) => !p.isBot);
  const allReady = humans.every((p) => p.ready || p.id === sess.playerId);
  const inLobby = lobby.phase === 'lobby';
  const modes = pickableModes(sess.kind === 'online' ? 'online' : 'lan');

  return (
    <Page title={title} back={leaveSession} testId="lobby" actions={leave}>
      <div className="grid sm:grid-cols-[minmax(0,1.5fr)_minmax(15rem,1fr)] gap-3 md:gap-4">
        <div className="order-2 sm:order-1 min-w-0">
          <Players lobby={lobby} sess={sess} />
        </div>
        <aside className="order-1 sm:order-2 flex flex-col gap-3 min-w-0">
          <StatusCard lobby={lobby} />
          {inLobby && (
            <div className="flex flex-wrap gap-2">
              <Button variant={me?.ready ? 'secondary' : 'mint'} size="lg" className="flex-1" testId="lobby-ready" autoFocus={!hostControls} onClick={() => lobbyAction({ a: 'ready', ready: !me?.ready })}>
                {me?.ready ? <Icon name="x" className="w-5 h-5" /> : <Icon name="check" className="w-5 h-5" />}
                {me?.ready ? t('lobby.unready') : t('lobby.ready')}
              </Button>
              {hostControls && (
                <Button variant="primary" size="lg" className="flex-1" testId="lobby-start" autoFocus onClick={() => lobbyAction({ a: 'start' })}>
                  <Icon name="play" className="w-5 h-5" />
                  {t('common.start')}
                </Button>
              )}
            </div>
          )}
          {inLobby && hostControls && !allReady && <p className="text-xs text-muted -mt-1">{t('lobby.notAllReady')}</p>}
          {inLobby && !hostControls && !lobby.quickMatch && <p className="text-xs text-muted -mt-1">{t('lobby.waitHost')}</p>}
          {sess.kind === 'online' && !lobby.quickMatch && sess.code && <InviteCard code={sess.code} />}
          {sess.kind === 'lan-host' && (
            <Panel className="p-3">
              <div className="eyebrow">{t('lobby.lanAddresses')}</div>
              {sess.lanAddresses.length ? (
                <ul className="font-mono font-bold text-lg text-sun select-text [user-select:text]">
                  {sess.lanAddresses.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('lobby.noAddress')}</p>
              )}
              <p className="text-xs text-muted mt-1">{t('lobby.lanHint')}</p>
            </Panel>
          )}
          <Panel className="p-3">
            <div className="flex items-center mb-1">
              <SectionTitle className="!px-0 !mb-0 flex-1">{t('lobby.settings')}</SectionTitle>
              {hostControls && inLobby && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)} testId="lobby-edit">
                  {t('lobby.edit')}
                </Button>
              )}
            </div>
            <SettingsSummary lobby={lobby} />
          </Panel>
        </aside>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title={t('lobby.settings')} testId="lobby-settings">
        <MatchSettingsForm value={lobby.settings} modes={modes} onChange={(settings) => lobbyAction({ a: 'settings', settings })} />
        <div className="flex justify-end mt-3">
          <Button variant="primary" autoFocus onClick={() => setEditing(false)}>
            {t('common.done')}
          </Button>
        </div>
      </Modal>
    </Page>
  );
}
