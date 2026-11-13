import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PROTOCOL_VERSION } from '@game/net';
import { mapIds } from '@game/maps';
import { validateContent } from '@game/content';
import express from 'express';
import { MatchRoom } from './room';
import { metrics, state } from './metrics';
import { log } from './log';
import { ProfileStore } from './profiles';

export interface StartOptions {
  port: number;
  region?: string;
  dataDir?: string;
}

/** Creates and starts the game server (HTTP endpoints + Colyseus rooms). */
export async function startServer(opts: StartOptions) {
  const port = opts.port;
  const region = opts.region ?? process.env.REGION ?? 'ap-south';
  const dataDir = opts.dataDir ?? process.env.DATA_DIR ?? './data';
  const contentErrors = validateContent();
  if (contentErrors.length) throw new Error(`content validation failed: ${contentErrors.join('; ')}`);

  const transport = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 });
  const app = transport.getExpressApp();
  app.use(express.json({ limit: '80kb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  const profiles = new ProfileStore(`${dataDir}/profiles.json`);

  app.get('/health', (_req, res) => {
    res.json({ ok: !state.draining, region, protocol: PROTOCOL_VERSION, maps: mapIds().length });
  });

  app.get('/metrics', async (_req, res) => {
    const rooms = await matchMaker.query({});
    const mem = process.memoryUsage();
    res.json({
      ...metrics,
      uptimeSec: Math.round((Date.now() - metrics.startedAt) / 1000),
      rooms: rooms.length,
      players: rooms.reduce((a, r) => a + r.clients, 0),
      cpu: process.cpuUsage(),
      rssMb: Math.round(mem.rss / 1048576),
      profiles: profiles.size,
      draining: state.draining,
    });
  });

  app.post('/api/profile/sync', (req, res) => {
    const { id, secret, profile, version } = req.body ?? {};
    const r = profiles.sync(String(id ?? ''), String(secret ?? ''), profile, Number(version) || 0);
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post('/api/profile/delete', (req, res) => {
    const { id, secret } = req.body ?? {};
    res.json({ ok: profiles.delete(String(id ?? ''), String(secret ?? '')) });
  });

  app.post('/api/report', (req, res) => {
    // Player reports: store only room code, reported player's display name and a reason enum.
    const { room, name, reason } = req.body ?? {};
    const reasons = ['name', 'cheating', 'griefing', 'other'];
    if (typeof room === 'string' && typeof name === 'string' && reasons.includes(reason)) {
      metrics.reports++;
      log('warn', 'report', { room: room.slice(0, 8), name: name.slice(0, 16), reason });
    }
    res.json({ ok: true });
  });

  const gameServer = new Server({ transport, greet: false });
  gameServer
    .define('match', MatchRoom)
    .filterBy(['quick', 'region'])
    .sortBy({ clients: -1 });

  await gameServer.listen(port);
  log('info', 'startup', { msg: `listening on ${port}`, region, protocol: PROTOCOL_VERSION });

  /** Graceful shutdown: stop new matches, let running ones finish (up to maxWaitMs), then stop. */
  async function drain(maxWaitMs = 6 * 60 * 1000) {
    if (state.draining) return;
    state.draining = true;
    log('info', 'shutdown', { msg: 'draining' });
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const rooms = await matchMaker.query({});
      if (rooms.length === 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    profiles.flush();
    await gameServer.gracefullyShutdown(false);
  }
  return { gameServer, drain, profiles };
}
