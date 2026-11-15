import { DEFAULT_LOADOUT, MODES, type Loadout, type ModeDef, type ModeId } from '@game/content';
import { getMap, mapIds } from '@game/maps';
import type { LobbySettings, Platform } from '@game/net';
import { useMemo } from 'react';
import { app } from '../core/app';
import { TEAM_COLORS } from '../core/settings';
import { useStore } from '../core/store';
import { t } from '../i18n';
import { MapPreview } from './MapPreview';
import { Panel, SectionTitle, Segmented, SelectCard, Stepper, Toggle } from './ui';

export const hex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** Team colour (respects the colour-blind preset). */
export function useTeamColors(): [string, string] {
  const cb = useStore(app, (s) => s.settings.accessibility.colorblind);
  const [r, b] = TEAM_COLORS[cb];
  return [hex(r), hex(b)];
}

export function lookToLoadout(look: string[] | undefined): Loadout {
  const l = look ?? [];
  return {
    head: l[0] || DEFAULT_LOADOUT.head,
    outfit: l[1] || DEFAULT_LOADOUT.outfit,
    jetpack: l[2] || DEFAULT_LOADOUT.jetpack,
    skin: l[3] || DEFAULT_LOADOUT.skin,
    emote: l[4] || DEFAULT_LOADOUT.emote,
    pose: l[5] || DEFAULT_LOADOUT.pose,
  };
}

export const modeName = (id: string) => t(`mode.${id}`);
export const mapName = (id: string) => t(`map.${id}`);
export const isTeamMode = (id: string) => MODES.find((m) => m.id === id)?.teams ?? false;

/** Modes for a picker. */
export function pickableModes(kind: 'bots' | 'online' | 'lan'): ModeDef[] {
  return MODES.filter((m) => m.selectable && m.id !== 'training' && m.id !== 'survival' && (kind === 'bots' ? m.bots : kind === 'online' ? m.online : m.lan));
}

interface MapMeta {
  id: string;
  theme: ReturnType<typeof getMap>['theme'];
  recommended: [number, number];
}

function useMaps(): MapMeta[] {
  return useMemo(
    () =>
      mapIds().map((id) => {
        const m = getMap(id);
        return { id, theme: m.theme, recommended: m.recommended };
      }),
    [],
  );
}

/** Theme swatch of a map: sky gradient, far skyline and a ground band (kept for compact contexts). */
export function MapSwatch({ theme, className = '' }: { theme: MapMeta['theme']; className?: string }) {
  return (
    <svg viewBox="0 0 160 72" preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`sky${theme.skyTop}${theme.skyBottom}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hex(theme.skyTop)} />
          <stop offset="1" stopColor={hex(theme.skyBottom)} />
        </linearGradient>
      </defs>
      <rect width="160" height="72" fill={`url(#sky${theme.skyTop}${theme.skyBottom})`} />
      <path d="M0 60 L40 60 L40 54 L70 54 L70 62 L104 62 L104 52 L130 52 L130 58 L160 58 L160 72 L0 72 Z" fill={hex(theme.solid)} />
      <path d="M0 60 L40 60 L40 54 L70 54 L70 62 L104 62 L104 52 L130 52 L130 58 L160 58" fill="none" stroke={hex(theme.rim)} strokeWidth="2" />
    </svg>
  );
}

export function MapPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const maps = useMaps();
  return (
    <div className="flex gap-3 overflow-x-auto snap-x scroll-px-2 pb-3 pt-2 px-2 -mx-2 [touch-action:pan-x_pan-y]" role="listbox" aria-label={t('setup.map')}>
      {maps.map((m) => {
        const on = value === m.id;
        return (
          <SelectCard key={m.id} selected={on} onClick={() => onChange(m.id)} testId={`map-${m.id}`} className="snap-start shrink-0 w-48 md:w-56 group">
            <span className="relative block overflow-hidden">
              <MapPreview id={m.id} width={224} height={100} className={`w-full transition-transform duration-[var(--duration-slow)] ease-[var(--ease-snap)] ${on ? 'scale-[1.04]' : 'group-hover:scale-[1.04]'}`} />
              <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[rgb(14_16_26/0.95)] via-transparent to-transparent" />
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${hex(m.theme.rim)}, transparent)` }} />
              <span className="absolute left-2.5 bottom-1.5 right-2.5 font-display font-extrabold text-[1.05rem] leading-tight truncate drop-shadow-[0_2px_4px_rgb(0_0_0/0.8)]">{mapName(m.id)}</span>
            </span>
            <span className="block px-2.5 pt-1.5 pb-2.5">
              <span className="block text-xs text-muted leading-snug line-clamp-2 min-h-8">{t(`map.${m.id}.feature`)}</span>
              <span className="mt-1.5 inline-flex items-center gap-1 text-[0.7rem] font-extrabold text-sky tabular-nums">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M9 7 A3 3 0 1 0 9.01 7 M3 20 C3 16 5.7 14 9 14 S15 16 15 20 M16 5.5 A3 3 0 0 1 16 11 M17.5 14.3 C19.6 15 21 16.8 21 20" />
                </svg>
                {t('setup.players', { min: m.recommended[0], max: m.recommended[1] })}
              </span>
            </span>
          </SelectCard>
        );
      })}
    </div>
  );
}

export function ModePicker({ value, modes, onChange }: { value: ModeId; modes: ModeDef[]; onChange: (id: ModeId) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 md:gap-3 pt-1 pb-2">
      {modes.map((m) => (
        <SelectCard key={m.id} selected={value === m.id} onClick={() => onChange(m.id)} testId={`mode-${m.id}`} className="p-3 pr-9 hover:-translate-y-0.5">
          <span className="flex items-center gap-2">
            <span className={`shrink-0 text-[0.62rem] tracking-wider font-extrabold px-1.5 py-0.5 rounded-md shadow-[inset_0_1px_0_rgb(255_255_255/0.45)] ${m.teams ? 'bg-gradient-to-b from-[#9be6ff] to-[#3fb8f0] text-[#032536]' : 'bg-gradient-to-b from-[#ffb28f] to-[#ff6f3a] text-[#3a1000]'}`}>{m.short}</span>
            <span className="font-display font-extrabold leading-tight line-clamp-2">{modeName(m.id)}</span>
          </span>
          <span className="block text-xs text-muted mt-1.5 leading-snug line-clamp-2">{t(`mode.${m.id}.desc`)}</span>
        </SelectCard>
      ))}
    </div>
  );
}

const TIMES = [180, 300, 480, 600, 900];

function scoreStep(mode: ModeId): number {
  return mode === 'koth' ? 25 : mode === 'ctf' || mode === 'leader' ? 1 : 5;
}

/** Full match-settings form (map, mode, limits, bots, toggles). */
export function MatchSettingsForm({ value, onChange, modes, minBots = 0, showMap = true, showMode = true }: { value: LobbySettings; onChange: (patch: Partial<LobbySettings>) => void; modes: ModeDef[]; minBots?: number; showMap?: boolean; showMode?: boolean }) {
  const def = MODES.find((m) => m.id === value.mode) ?? MODES[0];
  const timed = value.mode !== 'survival';
  const scored = value.mode !== 'survival' && value.mode !== 'bomb';
  const step = scoreStep(value.mode);
  return (
    <div className="flex flex-col gap-3">
      {showMap && (
        <section>
          <SectionTitle>{t('setup.map')}</SectionTitle>
          <MapPicker value={value.mapId} onChange={(mapId) => onChange({ mapId })} />
        </section>
      )}
      {showMode && (
        <section>
          <SectionTitle>{t('setup.mode')}</SectionTitle>
          <ModePicker value={value.mode} modes={modes} onChange={(mode) => onChange({ mode, scoreLimit: 0 })} />
        </section>
      )}
      <section>
        <SectionTitle>{t('setup.rules')}</SectionTitle>
        <Panel className="grid lg:grid-cols-2 gap-x-6 gap-y-0.5 p-2 md:p-3">
          <Stepper label={t('setup.bots')} value={value.botCount} min={minBots} max={11} onChange={(botCount) => onChange({ botCount })} testId="bots-count" />
          <Segmented
            label={t('setup.difficulty')}
            value={value.botDifficulty}
            onChange={(botDifficulty) => onChange({ botDifficulty })}
            options={[
              { value: 0, label: t('setup.easy') },
              { value: 1, label: t('setup.normal') },
              { value: 2, label: t('setup.hard') },
            ]}
          />
          {timed && (
            <Segmented
              label={t('setup.time')}
              value={TIMES.includes(value.timeLimit) ? value.timeLimit : 300}
              onChange={(timeLimit) => onChange({ timeLimit })}
              options={TIMES.map((s) => ({ value: s, label: t('setup.minutes', { n: s / 60 }) }))}
            />
          )}
          {scored && (
            <Stepper
              label={t('setup.score')}
              value={value.scoreLimit}
              min={0}
              max={Math.min(500, def.defaultScoreLimit * 5)}
              step={step}
              onChange={(scoreLimit) => onChange({ scoreLimit })}
              format={(v) => (v === 0 ? t('setup.scoreDefault', { n: def.defaultScoreLimit }) : String(v))}
            />
          )}
          {def.teams && <Toggle label={t('setup.friendlyFire')} value={value.friendlyFire} onChange={(friendlyFire) => onChange({ friendlyFire })} />}
          <Toggle label={t('setup.lowGravity')} value={value.lowGravity} onChange={(lowGravity) => onChange({ lowGravity })} />
          <Toggle label={t('setup.pickups')} value={value.pickups} onChange={(pickups) => onChange({ pickups })} />
        </Panel>
      </section>
    </div>
  );
}

export const DEFAULT_MATCH: LobbySettings = {
  mapId: 'rooftop-dusk',
  mode: 'ffa',
  timeLimit: 300,
  scoreLimit: 0,
  botCount: 5,
  botDifficulty: 1,
  friendlyFire: false,
  lowGravity: false,
  pickups: true,
  maxPlayers: 12,
};

/** Small platform glyph for lobby rows. */
export function PlatformIcon({ platform }: { platform: Platform }) {
  const label = t(`platform.${platform}`);
  return (
    <span title={label} className="inline-flex items-center gap-1 text-xs text-muted font-bold">
      <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {platform === 'web' && (
          <>
            <circle cx="8" cy="8" r="6.2" />
            <path d="M1.8 8 H14.2 M8 1.8 C5.5 4.5 5.5 11.5 8 14.2 M8 1.8 C10.5 4.5 10.5 11.5 8 14.2" />
          </>
        )}
        {(platform === 'android' || platform === 'ios') && (
          <>
            <rect x="4" y="1.5" width="8" height="13" rx="2" />
            <path d={platform === 'ios' ? 'M7 12.2 H9' : 'M6.5 3.6 H9.5'} />
          </>
        )}
        {platform === 'bot' && (
          <>
            <rect x="2.5" y="5" width="11" height="8" rx="2" />
            <path d="M8 5 V2.5 M5.8 9 H6 M10 9 H10.2" />
          </>
        )}
      </svg>
      <span className="sr-only sm:not-sr-only">{label}</span>
    </span>
  );
}

/** Crown glyph for the room host. */
export function CrownIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 16" className={className} aria-hidden="true">
      <path d="M2 13 L1 3 L6 7 L10 1 L14 7 L19 3 L18 13 Z" fill="var(--color-sun)" stroke="var(--color-ink)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
