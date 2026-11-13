# Jayu: Jetpack Brawl

An original 2D side-view multiplayer jetpack shooter. Fly, aim with dual sticks, grab weapons and fight in
fast 3–5 minute matches — online with cross-play (web, Android, iOS), over local Wi-Fi/hotspot (apps), or
offline against bots. One TypeScript codebase: Phaser 4 rendering, a deterministic pure-TS simulation,
Colyseus 0.18 server, React 19 menus, Capacitor 8 native shells.

## Quick start
```bash
npm ci
npm run dev           # web app at http://localhost:5173 (offline bot matches work immediately)
npm run dev:server    # game server at ws://localhost:2567 (online play)
```
Deep links: `/?play=volcano-base:tdm:5` starts a bot match; `/?join=ABC123` joins a private room.

## Scripts
| Command | What it does |
|---|---|
| `npm run check` | typecheck + lint + unit/netcode/determinism tests |
| `npm run test:all` | check + map validation + web/server builds + Playwright e2e |
| `npm run maps:build` / `maps:validate` | compile ASCII map sources to Tiled `.tmj` / validate them |
| `npm run bench` | 12-player scripted match through the real netcode; writes `docs/bench/bench-*.json` |
| `npm run balance -- 200 tdm 180` | bot-vs-bot balance runs per map |
| `npm run soak -- 60` | 60 game-minute soak (memory growth, desyncs) |
| `npm run load -- 40 60` | server load test: 40 six-player rooms against the built server |
| `npm run build:web` / `build:server` / `build:android` / `build:ios` | release builds (see docs/DEPLOY.md) |

## Docs
[Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Decisions](docs/DECISIONS.md) ·
[Balance](docs/BALANCE.md) · [Art style](docs/ART_STYLE.md) · [Deploy](docs/DEPLOY.md) ·
[QA checklist](docs/QA_CHECKLIST.md) · [Store listing kit](docs/store/LISTING.md) · [Asset licences](ASSETS_LICENSES.md)
