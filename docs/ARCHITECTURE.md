# Architecture

Jayu is one TypeScript codebase that ships to the web (PWA), Android and iOS (Capacitor 8), plus a
Colyseus 0.18 game server. The core idea: **one deterministic simulation, three ways to host it**.

```
packages/
  content/     data: weapons, grenades, modes, cosmetics, tuning, survival waves (validated at startup)
  maps/        Tiled .tmj maps, ASCII source compiler, loader, validator (npm run maps:build / maps:validate)
  sim/         pure-TS 60 Hz authoritative rules (no DOM, no Phaser): movement, jetpack, weapons, damage,
               pickups, 8 modes, lag-compensated hitscan, deterministic math (own sin/cos/atan2)
  bots/        AI players (grid pathfinding on the 1x2 body grid, combat, mode objectives, 3 difficulties)
  net/         protocol + binary codecs, delta snapshots, MatchHost (authority), GameClient (prediction,
               reconciliation, interpolation), transports (local, Colyseus, LAN/UDP reliability layer)
  client/      Phaser 4 scenes (world + HUD), procedural art, WebAudio synth audio, input devices
  ui/          React 19 menus, design system, i18n (en, hi), app/session state, profile & progression
  platform/    web vs Capacitor adapters: storage, haptics, lifecycle, native shell, sharing
  lan-plugin/  first-party Capacitor plugin: UDP datagrams + Bonjour (iOS) / NSD (Android) discovery
apps/
  game/        Vite entry, PWA config, styles/tokens
  server/      Colyseus rooms (MatchRoom wraps MatchHost), HTTP endpoints, profiles store
android/ ios/  Capacitor native projects
tests/         netcode, determinism, bench, balance, soak, load, e2e
```

## Data flow

```
 device input ──► Controls ──► Input (one per sim tick, device independent)
                                   │
                         GameClient│ predicts own movement (stepMovement), sends last 5 inputs / 2 ticks
                                   ▼
                  Transport (local | Colyseus WebSocket | LAN UDP + ReliableChannel)
                                   ▼
                     MatchHost ── Sim.step() @ 60 Hz ── BotDirector
                                   │ snapshot every 1 (local) / 2 (LAN) / 3 (online) ticks,
                                   │ per-player field deltas vs the client's acked baseline
                                   ▼
                 GameClient: reconcile (rewind+replay), interpolate others ~100 ms in the past
                                   ▼
               Phaser GameScene/HudScene read client.view() every frame (never write game state)
```

* **Inputs in, state out.** Clients only send inputs (move, aim, buttons, rolling action counters).
  The host never trusts positions, hits or ammo from clients.
* **Same code everywhere.** `MatchHost` + `Sim` run unchanged in the browser (offline), in the Colyseus
  room (online) and on a phone (LAN host). `tests/determinism` replays recorded input logs from all three
  and checks the state hash every 60 steps.
* **Data-driven content.** Adding a weapon = one record in `packages/content/src/weapons.ts` + a gun
  silhouette in `packages/client/src/art/characters.ts`; no engine code changes.
* **Transport interface.** `ClientTransport` / `PeerLink` (net/src/transport.ts); gameplay code never
  knows which transport is active. Control messages (hello, lobby, start, roster, end) must be delivered
  reliably; inputs/snapshots/pings tolerate loss.
* **Rendering** only reads `ClientView`. React never runs in the game loop; it shows menus and overlays.

## Netcode summary
See PROTOCOL.md. Authoritative host, client-side prediction of the local player with smoothed error
correction (snap above 96 px), remote entities interpolated 2 snapshots behind, lag-compensated hitscan
(host rewinds other players to the tick the shooter saw, capped at 333 ms), own projectiles predicted
and handed off, input-buffer-driven clock adjustment (client speeds up/slows down 3–4 %).

## Offline / online / LAN
* Offline: `createLocalSession` — host + client in one page via an in-memory transport (optionally with
  the dev network simulator).
* Online: Colyseus room per match; quick match (`filterBy quick, region`, bot backfill after 20 s, bots
  replace leavers after the 30 s reconnect grace), private rooms (6-char invite code = room id).
* LAN: the hosting phone runs `MatchHost`; `LanHostBridge` maps each `ip:port` to a `ReliableChannel`
  over the plugin's UDP socket; discovery via Bonjour/NSD service `_jayubrawl._udp`.
