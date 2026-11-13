import type { LobbySettings } from '@game/net';
import { useEffect, useState } from 'react';
import { app, createPrivateRoom, go, joinPrivateRoom, measurePings, quickMatch, updateSettings } from '../core/app';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Icon } from '../components/icons';
import { DEFAULT_MATCH, MatchSettingsForm, pickableModes } from '../components/match';
import { Button, Page, Panel, SectionTitle, Spinner, TextInput, sfx } from '../components/ui';

export const CODE_RE = /^[A-Z2-9]{6}$/;

function cleanCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function inviteFromUrl(): string {
  try {
    const c = cleanCode(new URLSearchParams(location.search).get('join') ?? '');
    return CODE_RE.test(c) ? c : '';
  } catch {
    return '';
  }
}

export function PingBadge({ ms }: { ms: number | undefined }) {
  if (ms === undefined) return <span className="text-xs text-muted font-bold">{t('online.measuring')}</span>;
  if (ms < 0) return <span className="text-xs text-danger font-bold">{t('online.unreachable')}</span>;
  const tone = ms < 90 ? 'text-mint' : ms < 160 ? 'text-sun' : 'text-coral';
  return <span className={`text-sm font-extrabold tabular-nums ${tone}`}>{t('online.ms', { n: ms })}</span>;
}

let roomSettings: LobbySettings = { ...DEFAULT_MATCH, botCount: 0 };

export function Online() {
  const regions = useStore(app, (s) => s.regions);
  const pings = useStore(app, (s) => s.pings);
  const region = useStore(app, (s) => s.settings.network.region);
  const [busy, setBusy] = useState<'' | 'quick' | 'create' | 'join'>('');
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState(inviteFromUrl);
  const [settings, setSettings] = useState<LobbySettings>(roomSettings);
  const [showRoom, setShowRoom] = useState(false);
  const selected = regions.find((r) => r.id === region) ?? regions[0];
  const valid = CODE_RE.test(code);

  useEffect(() => {
    roomSettings = settings;
  }, [settings]);

  useEffect(() => {
    if (!Object.keys(app.get().pings).length) void measurePings();
  }, []);

  const run = async (kind: 'quick' | 'create' | 'join', fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
      go('lobby');
    } catch {
      setBusy('');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await measurePings();
    setRefreshing(false);
  };

  return (
    <Page
      title={t('online.title')}
      testId="online"
      actions={
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-muted">
          <Icon name="globe" className="w-4 h-4" />
          {t('online.crossplayShort')}
        </span>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3 md:gap-4">
        <div className="flex flex-col gap-3">
          <Panel className="p-3 md:p-4">
            <Button variant="primary" size="lg" className="w-full !min-h-16 md:!text-3xl" testId="online-quick" autoFocus disabled={!!busy} onClick={() => run('quick', quickMatch)}>
              {busy === 'quick' ? <Spinner className="!w-7 !h-7" /> : <Icon name="play" className="w-8 h-8" />}
              {busy === 'quick' ? t('menu.connecting') : t('online.quick')}
            </Button>
            <p className="text-sm text-muted mt-2">{t('online.quickBody')}</p>
          </Panel>
          <Panel className="p-3 md:p-4">
            <SectionTitle className="!px-0">{t('online.joinTitle')}</SectionTitle>
            <div className="flex gap-2 items-end">
              <TextInput
                className="flex-1"
                value={code}
                onChange={(v) => setCode(cleanCode(v))}
                placeholder="ABC234"
                maxLength={6}
                uppercase
                mono
                testId="online-code"
                onEnter={() => valid && run('join', () => joinPrivateRoom(code))}
                invalid={code.length === 6 && !valid}
                label={t('online.codeLabel')}
              />
              <Button variant="mint" testId="online-join" disabled={!valid || !!busy} onClick={() => run('join', () => joinPrivateRoom(code))} className="!min-h-12">
                {busy === 'join' ? <Spinner className="!w-5 !h-5" /> : null}
                {t('online.join')}
              </Button>
            </div>
            <p className={`text-xs mt-1.5 ${code.length === 6 && !valid ? 'text-danger font-bold' : 'text-muted'}`}>{code.length === 6 && !valid ? t('online.codeInvalid') : t('online.codeHint')}</p>
          </Panel>
        </div>
        <div className="flex flex-col gap-3">
          <Panel className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1">
              <SectionTitle className="!px-0 !mb-0">{t('online.region')}</SectionTitle>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={refresh} disabled={refreshing} title={t('online.refresh')}>
                <Icon name="refresh" className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {t('online.refresh')}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('online.region')}>
              {regions.map((r) => {
                const on = r.id === selected?.id;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    key={r.id}
                    onClick={() => {
                      sfx('ui_toggle');
                      updateSettings((s) => ({ ...s, network: { ...s.network, region: r.id } }));
                    }}
                    className={`flex items-center gap-3 min-h-12 px-3 rounded-md border-2 border-ink text-left ${on ? 'bg-panel-2 ring-2 ring-sun' : 'bg-night/40 hover:bg-panel-2'}`}
                  >
                    <span className={`w-4 h-4 rounded-full border-2 border-ink ${on ? 'bg-sun' : 'bg-line'}`} />
                    <span className="font-bold flex-1 truncate">{r.name}</span>
                    <PingBadge ms={refreshing ? undefined : pings[r.id]} />
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel className="p-3 md:p-4">
            <SectionTitle className="!px-0">{t('online.createTitle')}</SectionTitle>
            <p className="text-sm text-muted mb-2">{t('online.createBody')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" testId="online-create" disabled={!!busy} onClick={() => run('create', () => createPrivateRoom(settings))}>
                {busy === 'create' ? <Spinner className="!w-5 !h-5" /> : <Icon name="lock" className="w-5 h-5" />}
                {t('online.create')}
              </Button>
              <Button variant="secondary" onClick={() => setShowRoom((v) => !v)} testId="online-room-settings">
                {showRoom ? t('online.hideSettings') : t('online.roomSettings')}
              </Button>
            </div>
          </Panel>
        </div>
      </div>
      {showRoom && (
        <div className="mt-4">
          <MatchSettingsForm value={settings} modes={pickableModes('online')} onChange={(p) => setSettings((v) => ({ ...v, ...p }))} />
        </div>
      )}
      <p className="flex items-center justify-center gap-2 text-xs text-muted mt-4 text-center">
        <Icon name="globe" className="w-4 h-4 shrink-0" />
        {t('online.crossplay')}
      </p>
    </Page>
  );
}
