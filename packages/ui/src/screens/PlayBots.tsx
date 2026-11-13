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
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4">
        <Panel className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-12 h-12 rounded-md bg-sun text-ink border-2 border-ink shrink-0">
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
            <ul className="grid sm:grid-cols-2 gap-1.5">
              {UPGRADES.map((u) => (
                <li key={u.id} className="rounded-md bg-panel-2 border-2 border-ink px-2.5 py-1.5">
                  <div className="font-bold text-sun text-sm leading-tight">{t(`upgrade.${u.id}`)}</div>
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
      className="flex flex-col text-left rounded-xl border-2 border-ink bg-panel shadow-chunky hover:bg-panel-2 hover:-translate-y-0.5 active:translate-y-1 active:shadow-none transition-all duration-[var(--duration-fast)] overflow-hidden"
    >
      <span className={`flex items-center gap-3 px-4 py-3 border-b-2 border-ink text-ink ${tone}`}>
        <Icon name={icon} className="w-8 h-8" />
        <span className="font-display font-extrabold text-xl leading-tight">{title}</span>
      </span>
      <span className="p-4 flex flex-col gap-2 flex-1">
        <span className="text-sm text-text leading-snug">{body}</span>
        {extra && <span className="mt-auto inline-flex self-start px-2 py-0.5 rounded-full border-2 border-ink bg-night text-sm font-bold text-mint tabular-nums">{extra}</span>}
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
          tone="bg-sun"
          title={t('training.tutorial')}
          body={t('training.tutorialBody')}
          extra={done ? t('training.completed') : t('training.recommended')}
          testId="training-tutorial"
          autoFocus
          onClick={() => startOffline({ mapId: 'training-grounds', mode: 'training' }, 'tutorial')}
        />
        <TrainingCard icon="target" tone="bg-coral" title={t('training.range')} body={t('training.rangeBody')} testId="training-range" onClick={train} />
        <TrainingCard icon="flag" tone="bg-mint" title={t('training.course')} body={t('training.courseBody')} extra={course} testId="training-course" onClick={train} />
      </div>
      <p className="text-center text-xs text-muted mt-4 px-4">{t('training.note')}</p>
    </Page>
  );
}
