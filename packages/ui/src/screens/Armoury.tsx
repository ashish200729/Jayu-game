import { COSMETICS, cosmeticsBy, type CosmeticCategory, type CosmeticDef, type Loadout } from '@game/content';
import { useState } from 'react';
import { app, lobbyAction, toast, updateProfile } from '../core/app';
import { buyCosmetic, equip, isUnlocked, levelInfo, type Profile } from '../core/profile';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/icons';
import { hex } from '../components/match';
import { Button, Modal, Page, Panel, SparkIcon, SparksBadge, Tabs, sfx, useMotionOk, useViewport } from '../components/ui';

const CATS: CosmeticCategory[] = ['head', 'outfit', 'jetpack', 'skin', 'emote', 'pose'];
const POSES: Record<string, string> = { pose_salute: 'salute', pose_flex: 'flex', pose_spin: 'spin' };
export const EMOTE_GLYPHS = ['👋', '😂', 'GG', '😠', '❤', '😎'];

function sendLook(p: Profile): void {
  const s = app.get().session;
  if (s?.lobby && s.lobby.phase === 'lobby') {
    const l = p.loadout;
    lobbyAction({ a: 'look', look: [l.head, l.outfit, l.jetpack, l.skin, l.emote, l.pose] });
  }
}

function Thumb({ item, loadout }: { item: CosmeticDef; loadout: Loadout }) {
  if (item.category === 'emote') {
    return <span className="grid place-items-center w-full h-full text-4xl font-display font-extrabold text-sun">{EMOTE_GLYPHS[item.variant] ?? '?'}</span>;
  }
  const preview = { ...loadout, [item.category]: item.id };
  return (
    <span className="grid place-items-center w-full h-full -mt-1">
      <Avatar loadout={preview} size={96} animate={false} pose={item.category === 'pose' ? POSES[item.id] ?? 'idle' : 'idle'} weapon={item.category === 'skin' ? 'comet' : 'kestrel'} />
    </span>
  );
}

function ItemCard({ item, profile, previewing, onPick, onBuy }: { item: CosmeticDef; profile: Profile; previewing: boolean; onPick: () => void; onBuy: () => void }) {
  const unlocked = isUnlocked(profile, item.id);
  const equipped = profile.loadout[item.category] === item.id;
  return (
    <div className={`relative flex flex-col rounded-lg border-2 border-ink overflow-hidden bg-panel shadow-chunky ${equipped ? 'ring-4 ring-mint' : previewing ? 'ring-4 ring-sun' : ''}`}>
      <button
        type="button"
        data-testid={`item-${item.id}`}
        aria-pressed={equipped}
        onPointerEnter={() => sfx('ui_hover')}
        onClick={onPick}
        className="flex flex-col text-left hover:bg-panel-2 min-h-12"
      >
        <span className="relative h-24 border-b-2 border-ink overflow-hidden" style={{ background: `linear-gradient(160deg, ${hex(item.colors[0] ?? 0x2a2f45)}55, transparent 70%)` }}>
          <Thumb item={item} loadout={profile.loadout} />
          {!unlocked && (
            <span className="absolute top-1 right-1 grid place-items-center w-6 h-6 rounded-full bg-night border-2 border-ink text-muted">
              <Icon name="lock" className="w-3.5 h-3.5" />
            </span>
          )}
          {equipped && <span className="absolute top-1 left-1 px-1.5 rounded-full bg-mint text-ink text-[0.65rem] font-extrabold border-2 border-ink">{t('armoury.equipped')}</span>}
        </span>
        <span className="px-2 pt-1 pb-1.5 font-bold text-sm leading-tight truncate">{t(`cos.${item.id}`)}</span>
      </button>
      {!unlocked && (
        <div className="flex items-center gap-1 px-2 pb-2 -mt-0.5">
          <span className="text-xs text-muted font-bold whitespace-nowrap">{t('common.level', { n: item.unlockLevel })}</span>
          {item.price > 0 && (
            <Button size="sm" variant={profile.sparks >= item.price ? 'primary' : 'secondary'} className="ml-auto !min-h-9 !px-2 !text-xs" onClick={onBuy} testId={`buy-${item.id}`}>
              <SparkIcon className="w-3.5 h-3.5" />
              {item.price}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function Armoury() {
  const profile = useStore(app, (s) => s.profile);
  const motionOk = useMotionOk();
  const { w, h } = useViewport();
  const [cat, setCat] = useState<CosmeticCategory>('head');
  const [preview, setPreview] = useState<CosmeticDef | null>(null);
  const [buying, setBuying] = useState<CosmeticDef | null>(null);
  const level = levelInfo(profile.xp).level;
  const items = cosmeticsBy(cat);
  const shown = preview && preview.category === cat ? { ...profile.loadout, [cat]: preview.id } : profile.loadout;
  const pose = cat === 'pose' ? POSES[shown.pose] ?? 'salute' : 'idle';
  const size = Math.round(Math.max(130, Math.min(h * 0.55, w * 0.3, 420)));

  const pick = (item: CosmeticDef) => {
    setPreview(item);
    if (isUnlocked(profile, item.id)) {
      const next = equip(app.get().profile, item.category, item.id);
      updateProfile(() => next);
      sendLook(next);
    }
  };

  const confirmBuy = () => {
    if (!buying) return;
    const next = buyCosmetic(app.get().profile, buying.id);
    if (!next) {
      toast('armoury.notEnough', 'error');
      setBuying(null);
      return;
    }
    const equipped = equip(next, buying.category, buying.id);
    updateProfile(() => equipped);
    sendLook(equipped);
    toast('armoury.bought', 'success');
    setPreview(buying);
    setBuying(null);
  };

  const previewName = preview && preview.category === cat ? t(`cos.${preview.id}`) : t(`cos.${profile.loadout[cat]}`);
  const previewLocked = preview && preview.category === cat && !isUnlocked(profile, preview.id);

  return (
    <Page title={t('nav.armoury')} testId="armoury" actions={<SparksBadge n={profile.sparks} />}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 md:gap-5 h-full min-h-0">
        <Panel className="flex flex-col items-center justify-center p-2 md:p-4 self-start max-h-full">
          <Avatar loadout={shown} size={size} pose={pose} animate={motionOk} weapon={cat === 'skin' ? 'comet' : 'kestrel'} />
          <div className="text-center mt-1 max-w-[14rem]">
            <div className="font-display font-extrabold text-lg leading-tight truncate">{previewName}</div>
            <div className="text-xs text-muted">{previewLocked ? t('armoury.previewLocked') : t('armoury.levelNow', { n: level })}</div>
          </div>
        </Panel>
        <div className="flex flex-col gap-2 min-h-0 min-w-0">
          <Tabs
            value={cat}
            onChange={(c) => {
              setCat(c);
              setPreview(null);
            }}
            testIdPrefix="armoury-tab-"
            className="shrink-0"
            options={CATS.map((c) => ({ value: c, label: t(`armoury.cat.${c}`) }))}
          />
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 -mx-1 pt-1 pb-2 flex flex-col gap-3">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2.5 md:gap-3">
              {items.map((item) => (
                <ItemCard key={item.id} item={item} profile={profile} previewing={preview?.id === item.id} onPick={() => pick(item)} onBuy={() => setBuying(item)} />
              ))}
            </div>
            <Panel className="p-3 flex items-start gap-3">
              <Icon name="star" className="w-6 h-6 text-sun shrink-0" />
              <div>
                <div className="font-bold">{t('store.title')}</div>
                <div className="text-sm text-muted">
                  {t('store.unavailable')} · {t('store.body', { n: COSMETICS.length })}
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
      <Modal open={!!buying} onClose={() => setBuying(null)} title={t('armoury.buyTitle')} testId="buy-modal">
        {buying && (
          <>
            <p className="mb-1">{t('armoury.buyBody', { name: t(`cos.${buying.id}`), n: buying.price })}</p>
            <p className="text-sm text-muted mb-4">{t('armoury.buyHint', { level: buying.unlockLevel, have: profile.sparks })}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBuying(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" autoFocus disabled={profile.sparks < buying.price} onClick={confirmBuy} testId="buy-confirm">
                <SparkIcon />
                {profile.sparks < buying.price ? t('armoury.notEnoughShort') : t('armoury.buy', { n: buying.price })}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </Page>
  );
}
