import { app, go, startOffline } from '../core/app';
import { levelInfo } from '../core/profile';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Avatar } from '../components/Avatar';
import { Button, Page } from '../components/ui';

export function MainMenu() {
  const profile = useStore(app, (s) => s.profile);
  const lvl = levelInfo(profile.xp);
  return (
    <Page title={t('app.name')} back={() => undefined} testId="main-menu">
      <div className="flex gap-6 h-full items-center">
        <Avatar loadout={profile.loadout} size={240} />
        <div className="flex flex-col gap-3">
          <p className="text-muted">{t('common.level', { n: lvl.level })}</p>
          <Button variant="primary" size="xl" testId="play-bots" onClick={() => startOffline({ mapId: 'training-grounds', mode: 'ffa', botCount: 3, timeLimit: 300 })}>
            {t('common.play')}
          </Button>
          <Button onClick={() => go('settings')}>Settings</Button>
        </div>
      </div>
    </Page>
  );
}
