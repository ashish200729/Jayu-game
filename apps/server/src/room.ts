import { Room, type Client } from '@colyseus/core';
import { MATCH } from '@game/content';
import { MatchHost, makeInviteCode, type LobbySettings } from '@game/net';
import { metrics, state } from './metrics';
import { log } from './log';

export interface RoomCreateOptions {
  quick?: boolean;
  region?: string;
  settings?: Partial<LobbySettings>;
}

const usedCodes = new Set<string>();

/** One Colyseus room = one MatchHost. Colyseus provides matchmaking, rooms and the WebSocket transport. */
export class MatchRoom extends Room {
  host!: MatchHost;
  quick = false;

  override onCreate(options: RoomCreateOptions = {}) {
    if (state.draining) throw new Error('server is restarting, try again in a minute');
    this.quick = !!options.quick;
    this.autoDispose = true;
    this.maxClients = this.quick ? MATCH.maxPlayersPublic : MATCH.maxPlayersPrivate;
    let code = makeInviteCode();
    while (usedCodes.has(code)) code = makeInviteCode();
    usedCodes.add(code);
    this.roomId = code;
    this.host = new MatchHost({
      kind: 'online',
      code,
      quickMatch: this.quick,
      fillDelay: Number(process.env.QUICK_FILL_SECONDS ?? 20),
      reconnectGrace: 30,
      recordInputs: process.env.RECORD_INPUTS === '1',
      settings: this.quick ? quickSettings() : { ...options.settings, maxPlayers: MATCH.maxPlayersPrivate },
      log: (m) => log('info', 'room', { room: code, msg: m }),
      onMatchEnd: () => metrics.matchesFinished++,
      onEmpty: () => {
        if (this.host.phase !== 'playing') void this.disconnect();
      },
    });
    this.setPrivate(!this.quick);
    this.setMetadata({ quick: this.quick, region: options.region ?? process.env.REGION ?? 'ap-south', mode: this.host.settings.mode, map: this.host.settings.mapId });
    this.onMessageBytes('m', (client: Client, data: Uint8Array) => {
      metrics.bytesIn += data.length;
      this.host.receive(client.sessionId, data);
    });
    this.setSimulationInterval(() => {
      this.host.update();
      if (this.host.isClosed) void this.disconnect();
      if (this.quick && (this.host.phase === 'results' || this.host.humanSlots >= this.maxClients)) void this.lock();
    }, 1000 / 60);
    metrics.roomsCreated++;
    log('info', 'room', { room: code, msg: 'created', quick: this.quick });
  }

  override onAuth() {
    if (state.draining && this.host.phase !== 'playing') throw new Error('server is restarting');
    return true;
  }

  override onJoin(client: Client) {
    this.host.connect(client.sessionId, {
      send: (data) => {
        metrics.bytesOut += data.length;
        client.sendBytes('m', data);
      },
      close: () => client.leave(),
    });
  }

  override onLeave(client: Client) {
    this.host.disconnect(client.sessionId);
  }

  override onDispose() {
    usedCodes.delete(this.roomId);
    const s = this.host.stats();
    metrics.tickMsMax = Math.max(metrics.tickMsMax, s.tick_ms_max);
    metrics.tickOverruns += s.overruns;
    this.host.close('room closed');
    log('info', 'room', { room: this.roomId, msg: 'disposed' });
  }
}

const QUICK_MAPS = ['rooftop-dusk', 'jungle-temple', 'snow-outpost', 'desert-canyon', 'orbital-station', 'shipyard', 'underground-lab', 'volcano-base', 'haunted-fortress'];
const QUICK_MODES: LobbySettings['mode'][] = ['ffa', 'ffa', 'tdm', 'tdm', 'ctf', 'koth'];

function quickSettings(): Partial<LobbySettings> {
  return {
    mapId: QUICK_MAPS[Math.floor(Math.random() * QUICK_MAPS.length)],
    mode: QUICK_MODES[Math.floor(Math.random() * QUICK_MODES.length)],
    timeLimit: 300,
    botDifficulty: 1,
    maxPlayers: MATCH.maxPlayersPublic,
  };
}
