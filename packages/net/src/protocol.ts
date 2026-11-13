import type { ModeId } from '@game/content';
import type { Input, MatchConfig, MatchResults } from '@game/sim';
import { ByteReader, ByteWriter, DecodeError } from './codec';

/**
 * Bump whenever any message layout or simulation rule that affects prediction changes.
 * Clients with a different version get an "Update required" screen.
 */
export const PROTOCOL_VERSION = 3;

export enum Msg {
  // client -> host
  Hello = 1,
  Inputs = 2,
  Lobby = 3,
  Ping = 4,
  SyncReq = 5,
  Leave = 6,
  // host -> client
  Welcome = 20,
  Reject = 21,
  LobbyState = 22,
  Start = 23,
  Snapshot = 24,
  End = 25,
  Pong = 26,
  Roster = 27,
  Kick = 28,
}

export type Platform = 'web' | 'android' | 'ios' | 'bot';

export interface HelloMsg {
  v: number;
  name: string;
  look: string[];
  token: string;
  platform: Platform;
  /** Private-room invite code the client expects (LAN/online sanity check). */
  code?: string;
}

export interface WelcomeMsg {
  playerId: number;
  token: string;
  protocol: number;
  hostKind: 'local' | 'online' | 'lan';
  snapshotRate: number;
}

export type RejectReason = 'version' | 'full' | 'kicked' | 'in-progress' | 'bad-request' | 'closed';
export interface RejectMsg {
  reason: RejectReason;
  serverVersion: number;
}

export interface LobbySettings {
  mapId: string;
  mode: ModeId;
  timeLimit: number;
  scoreLimit: number;
  botCount: number;
  botDifficulty: 0 | 1 | 2;
  friendlyFire: boolean;
  lowGravity: boolean;
  pickups: boolean;
  maxPlayers: number;
}

export interface LobbyPlayer {
  id: number;
  name: string;
  team: number;
  ready: boolean;
  isBot: boolean;
  ping: number;
  look: string[];
  platform: Platform;
  connected: boolean;
}

export interface LobbyStateMsg {
  code: string;
  hostId: number;
  phase: 'lobby' | 'starting' | 'playing' | 'results';
  countdown: number;
  settings: LobbySettings;
  players: LobbyPlayer[];
  quickMatch: boolean;
  /** Seconds until bots fill the room (quick match). */
  fillIn: number;
}

export type LobbyAction =
  | { a: 'ready'; ready: boolean }
  | { a: 'team'; team: number }
  | { a: 'settings'; settings: Partial<LobbySettings> }
  | { a: 'start' }
  | { a: 'kick'; id: number }
  | { a: 'look'; look: string[] }
  | { a: 'rematch' };

export interface StartMsg {
  matchId: number;
  config: MatchConfig;
  playerId: number;
  tick: number;
  snapshotRate: number;
}

export interface RosterEntry {
  id: number;
  name: string;
  look: string[];
  isBot: boolean;
  platform: Platform;
}
export interface RosterMsg {
  version: number;
  players: RosterEntry[];
}

export interface EndMsg {
  matchId: number;
  results: MatchResults;
}

export interface SyncReqMsg {
  what: 'roster' | 'start' | 'results' | 'lobby';
}

export interface PingMsg {
  t: number;
  rtt: number;
}
export interface PongMsg {
  t: number;
  tick: number;
}

const writer = new ByteWriter(2048);

export function encodeJson(type: Msg, payload: unknown): Uint8Array {
  writer.reset();
  writer.u8(type);
  writer.str(JSON.stringify(payload));
  return writer.finish();
}

export function decodeJson<T>(r: ByteReader): T {
  const s = r.str(64 * 1024);
  try {
    return JSON.parse(s) as T;
  } catch {
    throw new DecodeError('bad json');
  }
}

/** Inputs: newest last. Clients send the last few inputs redundantly so a lost packet loses nothing. */
export function encodeInputs(inputs: Input[], ackSnapshot: number): Uint8Array {
  writer.reset();
  writer.u8(Msg.Inputs);
  writer.uv(ackSnapshot);
  writer.u8(inputs.length);
  const base = inputs.length ? inputs[0].seq : 0;
  writer.uv(base);
  for (const i of inputs) {
    writer.uv(i.seq - base);
    writer.i8(i.moveX);
    writer.i8(i.moveY);
    writer.u16(i.aim);
    writer.u8(i.buttons);
    writer.u8(i.actions & 0xff);
    writer.u8((i.actions >>> 8) & 0xff);
    writer.u8((i.actions >>> 16) & 0x0f);
    writer.u8(i.throwPower);
    writer.u8(i.signal);
    writer.uv(i.viewTick);
  }
  return writer.finish();
}

export function decodeInputs(r: ByteReader): { ack: number; inputs: Input[] } {
  const ack = r.uv();
  const n = r.u8();
  if (n > 16) throw new DecodeError('too many inputs');
  const base = r.uv();
  const inputs: Input[] = [];
  for (let k = 0; k < n; k++) {
    const seq = base + r.uv();
    const moveX = r.i8();
    const moveY = r.i8();
    const aim = r.u16();
    const buttons = r.u8();
    const a0 = r.u8();
    const a1 = r.u8();
    const a2 = r.u8();
    const throwPower = r.u8();
    const signal = r.u8();
    const viewTick = r.uv();
    inputs.push({ seq, moveX, moveY, aim, buttons, actions: a0 | (a1 << 8) | ((a2 & 0xf) << 16), throwPower, signal, viewTick });
  }
  return { ack, inputs };
}

export function encodePing(t: number, rtt: number): Uint8Array {
  writer.reset();
  writer.u8(Msg.Ping);
  writer.f64(t);
  writer.uv(Math.round(rtt));
  return writer.finish();
}

export function encodePong(t: number, tick: number): Uint8Array {
  writer.reset();
  writer.u8(Msg.Pong);
  writer.f64(t);
  writer.uv(tick);
  return writer.finish();
}

export function encodeSimple(type: Msg): Uint8Array {
  return new Uint8Array([type]);
}

/** Generates a 6-character invite code without ambiguous characters. */
export function makeInviteCode(rand: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return s;
}

export function makeToken(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(rand() * 36).toString(36);
  return s;
}
