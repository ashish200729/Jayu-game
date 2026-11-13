# Balance notes

All numbers live in `packages/content/src` (tuning.ts, weapons.ts, grenades.ts, survival.ts).

## Movement
* Run 255 px/s (≈8 tiles/s): crossing a 100-tile map takes ~12 s on foot, ~6 s flying — fights start within ~4–8 s (measured by the balance runner, `avgFirstKillSec`).
* Gravity 1500 px/s², jetpack 2950 px/s² with a ramp from 40 % to 100 % over 0.16 s: a tap is a ~40 px hop, a hold climbs at up to 430 px/s.
* Fuel 100, drain 38/s (2.6 s of thrust ≈ 25–30 tiles of climb), refill 85/s after 0.35 s on the ground: flight is strong but you must land to refuel; vents refill mid-air.
* Strong air control (1900 px/s²) keeps dogfights readable; ice cuts ground acceleration to 520.

## Weapons (time-to-kill on a 100 HP target, no headshots, inside falloff range)
| Weapon | Slot | Dmg × rate | Approx TTK | Role |
|---|---|---|---|---|
| Sparrow | sidearm | 18 / 0.2 s | 1.0 s | infinite backup |
| Thunderclap | sidearm | 42 / 0.5 s | 1.0 s (3 hits) | precise sidearm |
| Hornet | primary | 11 / 0.075 s | 0.75 s | close-range spray, spawns with it |
| Kestrel | primary | 16 / 0.11 s | 0.66 s | all-rounder |
| Triplet | primary | 3×20 burst / 0.42 s | 0.42–0.84 s | mid-range burst |
| Mule | primary | 8×13 pellets / 0.75 s | 1 shot close | close range, heavy falloff |
| Heron | primary | 80 (×1.6 head) / 1.15 s | 1.15 s, 1 headshot | long range, scope zoom |
| Grizzly | primary | 15 / 0.085 s, 80 mag | 0.6 s | suppression, 3.2 s reload |
| Comet | heavy | 95 splash + 25 direct | 1 shot | rockets, rocket-jumps (40 % self damage) |
| Popper | heavy | 80 splash, bouncing | 1–2 shots | area denial |
| Torchie | heavy | 5 per puff @ 20/s + burn | ~0.8 s | very short range |
| Zapline | heavy | 105 piercing rail | 1 shot | pierces lines of players |
| Buzzsaw | heavy | 60 piercing, 4 bounces | 2 hits | corridors |

Heavies only come from contested map spawners (35 s respawn) with tiny reserves, telegraphed by a glow.

## Health and respawn
Regen starts 4 s after the last damage at 12 HP/s; health packs give +50; spawn protection 2 s (ends when
you fire); respawn 3 s; spawn choice maximises distance to enemies and avoids spawns with enemy line of sight.

## Measured (bot vs bot)
`npm run balance -- <matchesPerMap> tdm 180` writes `docs/bench/balance-*.json` with per-map red-team win rate
(target 45–55 %), weapon kill counts (every weapon must be used) and spawn-kill rate. All team maps are
mirrored left/right, so differences come only from bot randomness. Latest results are committed in docs/bench.

### Latest run (200 matches/map, TDM, 180 s, 6 bots, after the update-order fix)
| Map | Red win % | First kill (s) |
|---|---|---|
| training-grounds | 50.5 | 5.8 |
| rooftop-dusk | 51.5 | 7.0 |
| jungle-temple | 46.7 | 8.5 |
| snow-outpost | 44.0 | 6.2 |
| desert-canyon | 46.5 | 8.2 |
| orbital-station | 46.0 | 6.8 |
| shipyard | 56.0 | 7.3 |
| underground-lab | 52.5 | 6.8 |
| volcano-base | 45.0 | 6.5 |
| haunted-fortress | 48.0 | 8.1 |

8/10 inside 45–55 %. The two outliers lean in opposite directions at ~1.7σ (σ ≈ 3.5 % at n = 200) on
mirror-symmetric maps, consistent with sampling noise; before the per-tick update-order rotation, every
outlier favoured red (first-mover bias, up to 60.5 %). All 13 weapons register kills; spawn-kill rate < 5 %
on every map except the small training arena (9 %). Hornet dominates kill counts because every player spawns with it.
