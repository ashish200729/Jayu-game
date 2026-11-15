import { isNative, platform } from '@game/platform';
import { leaveSession } from '../core/app';
import { t } from '../i18n';
import { Icon } from '../components/icons';
import { Button, Page, Panel } from '../components/ui';

export function UpdateRequired() {
  return (
    <Page title={t('error.update')} back={leaveSession} testId="update-required">
      <div className="grid place-items-center min-h-full py-2">
        <Panel className="max-w-lg p-5 md:p-6 text-center flex flex-col items-center gap-3">
          <span className="grid place-items-center w-16 h-16 rounded-full bg-gradient-to-b from-[#fff0a6] to-[#ffb92e] text-[#2a1d00] shadow-[0_0_30px_-4px_rgb(255_200_70/0.7)]">
            <Icon name="refresh" className="w-9 h-9" />
          </span>
          <h2 className="font-display font-extrabold text-2xl md:text-3xl">{t('error.update')}</h2>
          <p className="text-text">{t('error.updateBody')}</p>
          {isNative ? (
            <p className="text-sm text-sun font-bold">{t(platform === 'ios' ? 'update.appStore' : 'update.playStore')}</p>
          ) : (
            <p className="text-sm text-muted">{t('update.webHint')}</p>
          )}
          <p className="text-sm text-muted">{t('update.offline')}</p>
          <div className="flex flex-wrap gap-2 justify-center mt-1">
            {!isNative && (
              <Button variant="primary" size="lg" autoFocus testId="update-reload" onClick={() => window.location.reload()}>
                <Icon name="refresh" className="w-6 h-6" />
                {t('update.reload')}
              </Button>
            )}
            <Button variant={isNative ? 'primary' : 'secondary'} size="lg" autoFocus={isNative} testId="update-menu" onClick={leaveSession}>
              {t('update.menu')}
            </Button>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
