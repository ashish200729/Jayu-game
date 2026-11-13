import { MATCH } from './tuning';

export type ModeId = 'ffa' | 'tdm' | 'ctf' | 'leader' | 'bomb' | 'koth' | 'survival' | 'training';

export interface ModeDef {
  id: ModeId;
  name: string;
  short: string;
  description: string;
  teams: boolean;
  respawn: boolean;
  defaultScoreLimit: number;
  defaultTimeLimit: number;
  online: boolean;
  lan: boolean;
  bots: boolean;
  /** Visible in the custom/private room picker. */
  selectable: boolean;
}

export const MODES: readonly ModeDef[] = [
  { id: 'ffa', name: 'Free-for-all', short: 'FFA', description: 'Everyone for themselves. Most kills wins.', teams: false, respawn: true, defaultScoreLimit: MATCH.ffaScoreLimit, defaultTimeLimit: MATCH.defaultTimeLimit, online: true, lan: true, bots: true, selectable: true },
  { id: 'tdm', name: 'Team Deathmatch', short: 'TDM', description: 'Two squads. First team to the kill limit wins.', teams: true, respawn: true, defaultScoreLimit: MATCH.tdmScoreLimit, defaultTimeLimit: MATCH.defaultTimeLimit, online: true, lan: true, bots: true, selectable: true },
  { id: 'ctf', name: 'Capture the Flag', short: 'CTF', description: 'Steal the enemy banner and bring it home.', teams: true, respawn: true, defaultScoreLimit: MATCH.ctfScoreLimit, defaultTimeLimit: MATCH.defaultTimeLimit, online: true, lan: true, bots: true, selectable: true },
  { id: 'leader', name: 'Protect the Leader', short: 'VIP', description: 'Guard your tough leader. Take down theirs.', teams: true, respawn: true, defaultScoreLimit: MATCH.leaderScoreLimit, defaultTimeLimit: MATCH.defaultTimeLimit, online: true, lan: true, bots: true, selectable: true },
  { id: 'bomb', name: 'Hot Potato', short: 'BOMB', description: 'Shoot someone to pass the ticking bomb. Last one standing wins.', teams: false, respawn: false, defaultScoreLimit: 1, defaultTimeLimit: MATCH.defaultTimeLimit, online: true, lan: true, bots: true, selectable: true },
  { id: 'koth', name: 'King of the Hill', short: 'KOTH', description: 'Hold the moving zone to score.', teams: true, respawn: true, defaultScoreLimit: MATCH.kothScoreLimit, defaultTimeLimit: MATCH.defaultTimeLimit, online: true, lan: true, bots: true, selectable: true },
  { id: 'survival', name: 'Survival Waves', short: 'WAVES', description: 'Team up against endless waves of drones.', teams: true, respawn: false, defaultScoreLimit: 0, defaultTimeLimit: 0, online: true, lan: true, bots: true, selectable: true },
  { id: 'training', name: 'Training', short: 'TRAIN', description: 'Range, obstacle course and tutorial.', teams: false, respawn: true, defaultScoreLimit: 0, defaultTimeLimit: 0, online: false, lan: false, bots: true, selectable: false },
];

export const MODE_IDS: readonly ModeId[] = MODES.map((m) => m.id);

export function modeDef(id: ModeId): ModeDef {
  const m = MODES.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mode ${id}`);
  return m;
}

export function modeIndex(id: ModeId): number {
  return MODE_IDS.indexOf(id);
}
