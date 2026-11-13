# Device QA checklist

Mark pass/fail per device: budget Android (3–4 GB, Helio G85 / SD 680), recent Android, iPhone, iPad,
desktop Chrome, Edge, Firefox, Safari.

| # | Check | Budget Android | Recent Android | iPhone | iPad | Desktop |
|---|---|---|---|---|---|---|
| 1 | Fresh install → menu in < 3 s, no console/native errors | | | | | |
| 2 | Tutorial completes with touch / keyboard+mouse / gamepad | | | | | |
| 3 | Bot match on every map, every bot mode; steady 60 fps, p99 frame < 20 ms (enable Settings → Graphics → Show FPS) | | | | | |
| 4 | Online quick match; private room web + Android + iPhone finish a match together | | | | | |
| 5 | LAN: Android hosts, iPhone joins (and reverse) on the same Wi-Fi | | | | | |
| 6 | LAN over a phone hotspot with mobile data off (no internet) | | | | | |
| 7 | iOS: deny Local Network permission → explainer shows how to enable → enable → discovery works | | | | | |
| 8 | Switch Wi-Fi → mobile data mid online match → reconnects within 30 s | | | | | |
| 9 | Background the app mid-match, return within 30 s → same match | | | | | |
| 10 | Incoming call during a match → resumes (offline match is paused) | | | | | |
| 11 | Low-battery / battery-saver mode; Settings → battery saver (30 fps) | | | | | |
| 12 | Airplane mode: bot matches, training, armoury, settings all work | | | | | |
| 13 | 12-player LAN host on a mid-range phone keeps 60 fps | | | | | |
| 14 | Android predictive back opens pause menu, never quits mid-match | | | | | |
| 15 | Hindi language: every screen fits, no overflow | | | | | |
| 16 | Memory < 300 MB after 30 min; battery < 12 % per 30 min | | | | | |
| 17 | Safe areas: no controls under notch / home indicator | | | | | |

Automated evidence lives in CI (unit, netcode, determinism, e2e) and `docs/bench/`.
