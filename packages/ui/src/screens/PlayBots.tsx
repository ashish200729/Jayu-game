import { UPGRADES, TICK_RATE } from '@game/content';
import type { LobbySettings } from '@game/net';
import { useState } from 'react';
import { app, startOffline } from '../core/app';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Icon, type IconName } from '../components/icons';
import { DEFAULT_MATCH, MapPicker, MatchSettingsForm, pickableModes } from '../components/match';
import { Button, Page, Panel, SectionTitle, Segmented, sfx } from '../components/ui';

function initialBots(): LobbySettings {
  const last = app.get().lastOffline;
  const s = last?.purpose === 'match' ? last.settings : null;
  if (s && s.mode && s.mode !== 'survival' && s.mode !== 'training') return { ...DEFAULT_MATCH, ...s, botCount: Math.max(1, s.botCount ?? DEFAULT_MATCH.botCount) };
  return { ...DEFAULT_MATCH };
}

export function PlayBots() {
  const [s, setS] = useState<LobbySettings>(initialBots);
  const modes = pickableModes('bots');
  return (
    <Page
      title={t('bots.title')}
      testId="bots"
      actions={
        <Button variant="primary" size="md" testId="bots-start" autoFocus onClick={() => startOffline(s, 'match')}>
          <Icon name="play" className="w-5 h-5" />
          {t('common.start')}
        </Button>
      }
    >
      <p className="text-muted text-sm mb-2 px-1">{t('bots.intro')}</p>
      <MatchSettingsForm value={s} modes={modes} minBots={1} onChange={(p) => setS((v) => ({ ...v, ...p }))} />
      <div className="flex justify-end mt-3">
        <Button variant="primary" size="lg" onClick={() => startOffline(s, 'match')}>
          <Icon name="play" className="w-6 h-6" />
          {t('bots.startMatch')}
        </Button>
      </div>
    </Page>
  );
}

export function SurvivalSetup() {
  const best = useStore(app, (st) => st.profile.stats.bestWave);
  const last = app.get().lastOffline?.settings;
  const [mapId, setMapId] = useState(last?.mode === 'survival' && last.mapId ? last.mapId : 'volcano-base');
  const [difficulty, setDifficulty] = useState<0 | 1 | 2>(last?.mode === 'survival' ? (last.botDifficulty ?? 1) : 1);
  const start = () => startOffline({ mapId, mode: 'survival', botDifficulty: difficulty, botCount: 0 }, 'match');
  return (
    <Page
      title={t('survival.title')}
      testId="survival"
      actions={
        <Button variant="primary" testId="survival-start" autoFocus onClick={start}>
          <Icon name="play" className="w-5 h-5" />
          {t('common.start')}
        </Button>
      }
    >
      <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 md:gap-4">
        <Panel className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="relative grid place-items-center w-12 h-12 rounded-[14px] bg-gradient-to-b from-[#fff0a6] to-[#ffb92e] text-[#2a1d00] shadow-[0_6px_18px_-6px_rgb(255_211_77/0.7)] shrink-0">
              <Icon name="waves" className="w-7 h-7" />
            </span>
            <div>
              <div className="font-display font-extrabold text-xl leading-tight">{t('survival.howTitle')}</div>
              <div className="text-sm text-muted">{best > 0 ? t('survival.best', { n: best }) : t('survival.noBest')}</div>
            </div>
          </div>
          <ol className="text-sm text-text space-y-1.5 list-decimal pl-5">
            <li>{t('survival.how1')}</li>
            <li>{t('survival.how2')}</li>
            <li>{t('survival.how3')}</li>
          </ol>
          <div>
            <SectionTitle className="!text-base !px-0">{t('survival.upgrades')}</SectionTitle>
            <ul className="grid grid-cols-2 gap-1.5">
              {UPGRADES.map((u) => (
                <li key={u.id} className="well rounded-[14px] px-3 py-2">
                  <div className="font-display font-bold text-sun text-[0.95rem] leading-tight">{t(`upgrade.${u.id}`)}</div>
                  <div className="text-xs text-muted leading-tight">{t(`upgrade.${u.id}.desc`)}</div>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <div className="flex flex-col gap-3 min-w-0">
          <section>
            <SectionTitle>{t('setup.map')}</SectionTitle>
            <MapPicker value={mapId} onChange={setMapId} />
          </section>
          <Panel className="py-2">
            <Segmented
              label={t('survival.difficulty')}
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: 0, label: t('setup.easy') },
                { value: 1, label: t('setup.normal') },
                { value: 2, label: t('setup.hard') },
              ]}
            />
            <p className="text-xs text-muted px-3 pb-1">{t('survival.diffHint')}</p>
          </Panel>
          <Button variant="primary" size="lg" onClick={start} className="self-end">
            <Icon name="play" className="w-6 h-6" />
            {t('survival.start')}
          </Button>
        </div>
      </div>
    </Page>
  );
}

function TrainingCard({ icon, title, body, extra, onClick, testId, tone, autoFocus }: { icon: IconName; title: string; body: string; extra?: string; onClick: () => void; testId: string; tone: string; autoFocus?: boolean }) {
  return (
    <button
      type="button"
      data-testid={testId}
      autoFocus={autoFocus}
      onPointerEnter={() => sfx('ui_hover')}
      onClick={() => {
        sfx('ui_click');
        onClick();
      }}
      className="tile group flex flex-col text-left rounded-[var(--radius-xl)] hover:-translate-y-1 active:translate-y-0 overflow-hidden"
    >
      <span className="relative flex items-center gap-3 px-4 pt-4 pb-3">
        <span className={`relative grid place-items-center w-12 h-12 rounded-[14px] shrink-0 bg-gradient-to-b ${tone}`}>
          <span aria-hidden="true" className="absolute inset-x-1 top-0.5 h-1/2 rounded-t-[12px] bg-white/30" />
          <Icon name={icon} className="relative w-6 h-6" strokeWidth={2.4} />
        </span>
        <span className="font-display font-extrabold text-xl leading-tight">{title}</span>
      </span>
      <span className="px-4 pb-4 flex flex-col gap-3 flex-1">
        <span className="text-sm text-muted leading-relaxed">{body}</span>
        {extra && <span className="mt-auto inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full well-sunken text-xs font-extrabold text-mint tabular-nums"><span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-mint shadow-[0_0_8px_rgb(140_240_106/0.9)]" />{extra}</span>}
      </span>
    </button>
  );
}

export function TrainingSetup() {
  const stats = useStore(app, (s) => s.profile.stats);
  const done = useStore(app, (s) => s.profile.tutorialDone);
  const course = stats.bestCourseTicks > 0 ? t('training.bestTime', { s: (stats.bestCourseTicks / TICK_RATE).toFixed(2) }) : t('training.noTime');
  const train = () => startOffline({ mapId: 'training-grounds', mode: 'training' }, 'training');
  return (
    <Page title={t('training.title')} testId="training">
      <div className="grid sm:grid-cols-3 gap-3 md:gap-5 max-w-6xl mx-auto pt-1">
        <TrainingCard
          icon="star"
          tone="from-[#fff0a6] to-[#ffb92e] text-[#2a1d00] shadow-[0_6px_18px_-6px_rgb(255_211_77/0.7)]"
          title={t('training.tutorial')}
          body={t('training.tutorialBody')}
          extra={done ? t('training.completed') : t('training.recommended')}
          testId="training-tutorial"
          autoFocus
          onClick={() => startOffline({ mapId: 'training-grounds', mode: 'training' }, 'tutorial')}
        />
        <TrainingCard icon="target" tone="from-[#ffc2a6] to-[#ff6a36] text-[#3a1000] shadow-[0_6px_18px_-6px_rgb(255_122_69/0.7)]" title={t('training.range')} body={t('training.rangeBody')} testId="training-range" onClick={train} />
        <TrainingCard icon="flag" tone="from-[#c4ffa6] to-[#4fc63a] text-[#0d2a06] shadow-[0_6px_18px_-6px_rgb(140_240_106/0.6)]" title={t('training.course')} body={t('training.courseBody')} extra={course} testId="training-course" onClick={train} />
      </div>
      <p className="text-center text-xs text-muted mt-4 px-4">{t('training.note')}</p>
    </Page>
  );
}
