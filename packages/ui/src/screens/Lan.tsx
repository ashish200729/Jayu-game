import { LAN_DEFAULT_PORT, type LanServiceInfo, type LocalNetworkPermission } from '@game/lan';
import { PROTOCOL_VERSION, type LobbySettings } from '@game/net';
import { platform, storage, supportsLan } from '@game/platform';
import { useEffect, useState } from 'react';
import { app, go, hostLan, joinLan, toast } from '../core/app';
import { localNetworkStatus, openAppSettings, startLanDiscovery } from '../core/lan';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Icon } from '../components/icons';
import { DEFAULT_MATCH, MatchSettingsForm, mapName, modeName, pickableModes } from '../components/match';
import { Button, Page, Panel, SectionTitle, Spinner, TextInput } from '../components/ui';

const INTRO_KEY = 'lan.introSeen';
const HOST_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;

function WebOnly() {
  return (
    <Page title={t('lan.title')} testId="lan">
      <div className="grid place-items-center min-h-full py-4">
        <Panel className="max-w-xl p-5 md:p-6 text-center flex flex-col items-center gap-3">
          <span className="grid place-items-center w-16 h-16 rounded-full bg-mint text-ink border-2 border-ink">
            <Icon name="wifi" className="w-9 h-9" />
          </span>
          <h2 className="font-display font-extrabold text-2xl">{t('lan.webTitle')}</h2>
          <p className="text-text">{t('error.lanWeb')}</p>
          <p className="text-sm text-muted">{t('lan.webAlt')}</p>
          <div className="flex flex-wrap gap-2 justify-center mt-1">
            <Button variant="primary" size="lg" autoFocus onClick={() => go('online')} testId="lan-online">
              <Icon name="globe" className="w-6 h-6" />
              {t('lan.playOnline')}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => go('bots')}>
              <Icon name="bot" className="w-6 h-6" />
              {t('menu.bots')}
            </Button>
          </div>
        </Panel>
      </div>
    </Page>
  );
}

function Intro({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="grid place-items-center min-h-full py-2">
      <Panel className="max-w-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-12 h-12 rounded-full bg-mint text-ink border-2 border-ink shrink-0">
            <Icon name="wifi" className="w-7 h-7" />
          </span>
          <h2 className="font-display font-extrabold text-2xl leading-tight">{t('lan.introTitle')}</h2>
        </div>
        <ul className="text-text space-y-1.5 list-disc pl-5">
          <li>{t('lan.intro1')}</li>
          <li>{t('lan.intro2')}</li>
          <li>{t('lan.intro3')}</li>
        </ul>
        {platform === 'ios' && <p className="text-sm text-sun font-bold">{t('lan.introIos')}</p>}
        <Button variant="primary" size="lg" autoFocus className="self-end" onClick={onContinue} testId="lan-continue">
          {t('common.continue')}
        </Button>
      </Panel>
    </div>
  );
}

function Denied({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid place-items-center min-h-full py-2">
      <Panel className="max-w-2xl p-5 flex flex-col gap-3">
        <h2 className="font-display font-extrabold text-2xl text-coral">{t('lan.deniedTitle')}</h2>
        <p>{t('lan.deniedBody')}</p>
        <ol className="list-decimal pl-5 text-sm text-muted space-y-1">
          <li>{t(platform === 'ios' ? 'lan.deniedIos1' : 'lan.deniedAndroid1')}</li>
          <li>{t(platform === 'ios' ? 'lan.deniedIos2' : 'lan.deniedAndroid2')}</li>
          <li>{t('lan.denied3')}</li>
        </ol>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" onClick={onRetry}>
            <Icon name="refresh" className="w-5 h-5" />
            {t('lan.checkAgain')}
          </Button>
          <Button variant="primary" autoFocus onClick={() => void openAppSettings()} testId="lan-open-settings">
            {t('lan.openSettings')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function ServiceRow({ s, onJoin, busy }: { s: LanServiceInfo; onJoin: () => void; busy: boolean }) {
  const m = s.meta ?? {};
  const mismatch = Number(m.v) !== PROTOCOL_VERSION;
  return (
    <li className="flex items-center gap-3 p-2.5 rounded-md border-2 border-ink bg-night/40">
      <span className="grid place-items-center w-10 h-10 rounded-md bg-mint text-ink border-2 border-ink shrink-0">
        <Icon name="wifi" className="w-6 h-6" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold truncate">{m.hostName || s.name}</span>
        <span className="block text-xs text-muted truncate">
          {m.mode ? modeName(m.mode) : ''} · {m.map ? mapName(m.map) : ''} · {t('lan.playersOf', { n: m.players ?? '?', max: m.max ?? '12' })}
        </span>
      </span>
      {mismatch ? (
        <span className="text-xs font-bold text-coral text-right max-w-28">{t('lan.updateRequired')}</span>
      ) : (
        <Button variant="mint" size="sm" disabled={busy} onClick={onJoin} className="!min-h-11">
          {t('online.join')}
        </Button>
      )}
    </li>
  );
}

function LanMain() {
  const services = useStore(app, (s) => s.lanServices);
  const [settings, setSettings] = useState<LobbySettings>({ ...DEFAULT_MATCH, botCount: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState('');
  const [port, setPort] = useState(String(LAN_DEFAULT_PORT));

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    startLanDiscovery((list) => app.set({ lanServices: list }))
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch(() => toast('lan.discoveryFailed', 'error'));
    return () => {
      cancelled = true;
      stop?.();
      app.set({ lanServices: [] });
    };
  }, []);

  const host = async () => {
    setBusy(true);
    try {
      await hostLan(settings);
      go('lobby');
    } catch {
      toast('lan.hostFailed', 'error');
      setBusy(false);
    }
  };
  const join = async (h: string, p: number) => {
    setBusy(true);
    try {
      await joinLan(h, p);
      go('lobby');
    } catch {
      toast('lan.joinFailed', 'error');
      setBusy(false);
    }
  };
  // "192.168.1.5:47820" in the address box also works.
  const [hostPart, portPart] = addr.trim().split(':');
  const portNum = Number(portPart || port);
  const manualOk = HOST_RE.test(hostPart ?? '') && Number.isInteger(portNum) && portNum > 0 && portNum < 65536;

  return (
    <>
      <div className="grid md:grid-cols-2 gap-3 md:gap-4">
        <Panel className="p-3 md:p-4 flex flex-col gap-2">
          <SectionTitle className="!px-0">{t('lan.hostTitle')}</SectionTitle>
          <p className="text-sm text-muted">{t('lan.hostBody')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" testId="lan-host" autoFocus disabled={busy} onClick={host}>
              {busy ? <Spinner className="!w-6 !h-6" /> : <Icon name="wifi" className="w-6 h-6" />}
              {t('lan.host')}
            </Button>
            <Button variant="secondary" onClick={() => setShowSettings((v) => !v)}>
              {showSettings ? t('online.hideSettings') : t('online.roomSettings')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('lan.hotspot')}</p>
        </Panel>
        <Panel className="p-3 md:p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SectionTitle className="!px-0 !mb-0">{t('lan.nearby')}</SectionTitle>
            <Spinner className="!w-4 !h-4 !border-2 ml-1" />
          </div>
          {services.length === 0 ? (
            <p className="text-sm text-muted py-2">{t('lan.searching')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {services.map((s) => (
                <ServiceRow key={s.name} s={s} busy={busy} onJoin={() => join(s.host, s.port)} />
              ))}
            </ul>
          )}
          <div className="border-t-2 border-line pt-2 mt-1">
            <div className="text-sm font-bold text-muted mb-1">{t('lan.manual')}</div>
            <div className="flex gap-2 items-end">
              <TextInput className="flex-1" value={addr} onChange={setAddr} placeholder="192.168.43.1" inputMode="url" label={t('lan.address')} onEnter={() => manualOk && join(hostPart, portNum)} />
              <TextInput className="w-24" value={port} onChange={(v) => setPort(v.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" label={t('lan.port')} />
              <Button variant="mint" testId="lan-join-manual" disabled={!manualOk || busy} onClick={() => join(hostPart, portNum)} className="!min-h-12">
                {t('online.join')}
              </Button>
            </div>
          </div>
        </Panel>
      </div>
      {showSettings && (
        <div className="mt-4">
          <MatchSettingsForm value={settings} modes={pickableModes('lan')} onChange={(p) => setSettings((v) => ({ ...v, ...p }))} />
        </div>
      )}
    </>
  );
}

export function Lan() {
  const [stage, setStage] = useState<'loading' | 'intro' | 'denied' | 'ready'>('loading');
  const check = async () => {
    const st: LocalNetworkPermission = await localNetworkStatus();
    setStage(st === 'denied' ? 'denied' : 'ready');
  };
  useEffect(() => {
    if (!supportsLan()) return;
    let alive = true;
    void storage
      .get(INTRO_KEY)
      .catch(() => null)
      .then(async (seen) => {
        if (!alive) return;
        if (!seen) setStage('intro');
        else {
          const st = await localNetworkStatus();
          if (alive) setStage(st === 'denied' ? 'denied' : 'ready');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!supportsLan()) return <WebOnly />;
  return (
    <Page title={t('lan.title')} testId="lan">
      {stage === 'loading' && (
        <div className="grid place-items-center h-full">
          <Spinner />
        </div>
      )}
      {stage === 'intro' && (
        <Intro
          onContinue={() => {
            void storage.set(INTRO_KEY, '1');
            void check();
          }}
        />
      )}
      {stage === 'denied' && <Denied onRetry={() => void check()} />}
      {stage === 'ready' && <LanMain />}
    </Page>
  );
}
