import { t } from '../i18n';
import { Icon } from '../components/icons';
import { Page, Panel, SectionTitle } from '../components/ui';

const LIBS: [string, string][] = [
  ['Phaser 4', 'MIT'],
  ['React', 'MIT'],
  ['Colyseus', 'MIT'],
  ['Capacitor', 'MIT'],
  ['Motion', 'MIT'],
  ['Tailwind CSS', 'MIT'],
];

const FONTS = ['Baloo 2', 'Nunito', 'Noto Sans Devanagari'];

export function Credits() {
  return (
    <Page title={t('nav.credits')} testId="credits">
      <div className="max-w-4xl mx-auto flex flex-col gap-3 pb-2">
        <Panel className="p-4 md:p-6 text-center">
          <div className="font-display font-extrabold text-5xl md:text-6xl [:root[lang=hi]_&]:leading-[1.3] text-sun drop-shadow-[0_4px_0_var(--color-ink)] [-webkit-text-stroke:2px_var(--color-ink)]">{t('app.name').toUpperCase()}</div>
          <div className="font-display font-bold tracking-[0.25em] [:root[lang=hi]_&]:tracking-normal uppercase text-sm md:text-base">{t('app.tagline')}</div>
          <p className="text-muted mt-3 max-w-xl mx-auto">{t('credits.thanks')}</p>
        </Panel>
        <div className="grid md:grid-cols-2 gap-3">
          <Panel className="p-4">
            <SectionTitle className="!px-0">{t('credits.team')}</SectionTitle>
            <dl className="flex flex-col gap-1.5">
              {(['design', 'code', 'art', 'audio'] as const).map((k) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line/50 pb-1.5 last:border-b-0">
                  <dt className="text-muted">{t(`credits.${k}`)}</dt>
                  <dd className="font-bold">{t('credits.jayuTeam')}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted mt-3 flex gap-2">
              <Icon name="star" className="w-4 h-4 text-sun shrink-0 mt-0.5" />
              {t('credits.original')}
            </p>
          </Panel>
          <Panel className="p-4">
            <SectionTitle className="!px-0">{t('credits.builtWith')}</SectionTitle>
            <ul className="flex flex-col gap-1.5">
              {LIBS.map(([name, lic]) => (
                <li key={name} className="flex justify-between gap-3 border-b border-line/50 pb-1.5">
                  <span className="font-bold">{name}</span>
                  <span className="text-muted text-sm">{t('credits.license', { l: lic })}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3">
                <span className="font-bold">{t('credits.fonts', { list: FONTS.join(' · ') })}</span>
                <span className="text-muted text-sm shrink-0">{t('credits.license', { l: 'SIL OFL 1.1' })}</span>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
