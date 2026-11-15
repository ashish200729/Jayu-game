import { useState } from 'react';
import { app, cloudSync, resetProfile, toast } from '../core/app';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Icon } from './icons';
import { Button, Modal, Panel, SectionTitle, Spinner } from './ui';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Guest account: id, cloud sync and data deletion (shared by Profile and Settings). */
export function AccountPanel({ links = false }: { links?: boolean }) {
  const id = useStore(app, (s) => s.profile.id);
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const privacy = env.VITE_PRIVACY_URL;
  const support = env.VITE_SUPPORT_EMAIL;

  const sync = async () => {
    setSyncing(true);
    const ok = await cloudSync();
    setSyncing(false);
    toast(ok ? 'account.synced' : 'account.syncFailed', ok ? 'success' : 'error');
  };
  const del = async () => {
    setDeleting(true);
    await resetProfile();
    setDeleting(false);
    setConfirm(false);
    toast('account.deleted', 'success');
  };

  return (
    <Panel className="p-3 md:p-4 flex flex-col gap-3">
      <SectionTitle className="!px-0 !mb-0">{t('account.title')}</SectionTitle>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">{t('account.guestId')}</div>
          <div className="font-mono font-extrabold text-2xl tracking-[0.25em] text-sun" data-testid="guest-id">
            {id.slice(0, 6).toUpperCase()}
          </div>
        </div>
        <Button onClick={sync} disabled={syncing} testId="account-sync">
          {syncing ? <Spinner className="!w-5 !h-5" /> : <Icon name="refresh" className="w-5 h-5" />}
          {t('account.sync')}
        </Button>
      </div>
      <p className="text-xs text-muted">{t('account.guestBody')}</p>
      {links && (privacy || support) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {privacy && (
            <a href={privacy} target="_blank" rel="noreferrer" className="text-sky underline font-bold min-h-10 inline-flex items-center">
              {t('account.privacy')}
            </a>
          )}
          {support && (
            <a href={`mailto:${support}`} className="text-sky underline font-bold min-h-10 inline-flex items-center">
              {t('account.support', { email: support })}
            </a>
          )}
        </div>
      )}
      <div className="border-t border-white/10 pt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted max-w-md">{t('account.deleteBody')}</span>
        <Button variant="danger" onClick={() => setConfirm(true)} testId="account-delete">
          {t('account.delete')}
        </Button>
      </div>
      <Modal open={confirm} onClose={() => !deleting && setConfirm(false)} title={t('account.deleteTitle')} testId="delete-modal">
        <p className="mb-4">{t('account.deleteConfirm')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" autoFocus onClick={() => setConfirm(false)} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={del} disabled={deleting} testId="delete-confirm">
            {deleting && <Spinner className="!w-5 !h-5" />}
            {t('account.deleteYes')}
          </Button>
        </div>
      </Modal>
    </Panel>
  );
}
