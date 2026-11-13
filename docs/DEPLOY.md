# Deploying

## Build commands
| Target | Command | Output |
|---|---|---|
| Web / PWA | `npm run build:web` | `apps/game/dist` (static) |
| Game server | `npm run build:server` | `apps/server/dist/main.js` |
| Android | `npm run build:android` | `android/app/build/outputs/bundle/release/app-release.aab` |
| iOS | `npm run build:ios`, then Xcode 26 → Product → Archive | archive for TestFlight |

Set `VITE_SERVER_URL=wss://play.example.com` (or `VITE_REGIONS='[{"id":"ap-south","name":"Mumbai","url":"wss://..."}]'`)
when building the web/app bundle. Optional: `VITE_PRIVACY_URL`, `VITE_SUPPORT_EMAIL`.

## Game server
Environment: `PORT` (2567), `REGION` (ap-south), `DATA_DIR` (profiles store, persistent volume), `CORS_ORIGIN`.
Endpoints: `GET /health` (load balancer health check), `GET /metrics` (rooms, players, CPU, RSS, tick
overruns, errors — no personal data), `POST /api/profile/sync`, `POST /api/profile/delete`, `POST /api/report`.
`SIGTERM` drains: no new rooms, running matches finish (≤ 6 min), profiles flushed, then exit.

### Plain VPS (first region: Mumbai / ap-south)
1. Ubuntu VPS with 2 vCPU in Mumbai, DNS `play.example.com` → VPS IP.
2. Install Docker; edit `deploy/Caddyfile` with your domain.
3. `docker compose -f deploy/docker-compose.yml up -d --build` (Caddy terminates TLS → `wss://`).
4. Check `https://play.example.com/health`.
Updates: `docker compose up -d --build` (the old container drains thanks to `stop_grace_period: 7m`).

### Colyseus Cloud
Colyseus Cloud runs Node apps with `colyseus` ≥ 0.15 entry points. Point it at `apps/server` with build command
`npm ci && npm run build:server` and start command `node apps/server/dist/main.js`, region Mumbai, then set
`VITE_SERVER_URL` to the Cloud endpoint.

## Web hosting
`apps/game/dist` is a static site. `index.html` and `sw.js` must be `no-cache`; `/assets/*` immutable.
Configs: `apps/game/public/_headers` (Cloudflare Pages/Netlify), `deploy/netlify.toml`, `deploy/vercel.json`.

## Android (Google Play)
1. Create an upload key: `keytool -genkeypair -v -keystore jayu-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`.
2. Create `android/keystore.properties` (git-ignored): `storeFile=../jayu-upload.jks`, `storePassword=…`, `keyAlias=upload`, `keyPassword=…`.
3. `BUILD_NUMBER=<n> npm run build:android` → upload the `.aab`, enrol in Play App Signing.
4. compile/target SDK 36, minSdk 24. The app has no NDK libraries (the LAN plugin is Kotlin), so 16 KB page
   size is satisfied; still confirm "Supports 16 KB" in App Bundle Explorer.

## iOS (App Store)
1. `npm run build:ios`, open `ios/App/App.xcodeproj` in Xcode 26+, set the Team and bundle id.
2. Info.plist already contains `NSLocalNetworkUsageDescription`, `NSBonjourServices (_jayubrawl._udp)`, landscape only, hidden status bar.
3. `PrivacyInfo.xcprivacy` is included in the app target; complete App Privacy answers in App Store Connect to match docs/store/LISTING.md.
4. Archive → upload to TestFlight.
