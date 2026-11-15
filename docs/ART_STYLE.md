# Art style guide

**Look:** chunky, friendly cartoon soldiers with oversized heads, thick dark outlines (2 px at 1×, colour
`#1b1d26`), flat fills with one shade band, bright saturated palettes per map. Not stick figures, not gore:
deaths are a cartoon parts-burst with confetti.

* **Characters** (packages/client/src/art/characters.ts): separate parts drawn procedurally at 4x (`CHAR_SCALE`) so
  they stay crisp at high camera zoom on retina phones — head (helmet/hair variant, glossy cartoon eye, profile nose),
  torso (tactical vest, pouches, harness strap, belt, team shoulder pad + chest patch), legs (knee pad, boots), arms
  (gloves), jetpack, gun. Every fill uses `paint()` (art/draw.ts): top-lit gradient, soft top sheen, optional specular
  glint, and a coloured outline derived from the fill (`lineOf`) instead of flat black. Part footprints and anchors are
  fixed contracts (documented per function) so the rig, menus and ragdoll compose them without knowing how they're drawn.
* **Rig** (game/rig.ts): breathing idle, run cycle, flight lean, landing squash (off with reduce-motion), layered additive
  jet flame (plume + white-hot core + glow), floor contact shadow, crisp name tags.
* **Weapons:** each gun has a distinct silhouette with metal shading, grip texture, glowing accent strips and lens glints;
  tracer colour per weapon.
* **Environments:** tiles (art/world.ts) are rendered into 512 px chunks at the expected screen zoom (1x–2.5x by quality)
  through a mask: per-theme material (brick, riveted metal panels, rock, ice), distance-field depth shading, rounded convex
  corners, coloured outline, lit top/left and shaded bottom/right edges, cast shadows under overhangs, and theme surface
  caps (grass, snow drifts + icicles, sand ripples, magma cracks, neon strips, dock hazard paint, moss). Gradients are
  pre-rendered stamps (fast on phones). Backdrops (art/backdrop.ts) are painted parallax layers per theme (volcano with
  crater glow and lava rivulets, ringed planet + nebula + station, mesas, pine ridges with snow caps, cranes and
  containers, castle on a hill, temple, hangar) with sky rim-light and atmospheric haze, drawn by an unzoomed
  BackdropScene under the world camera. Lava/water are scrolling textures with wavy surfaces; dark maps use a light mask.
* **Camera:** a fixed world height is visible (430 px touch / 540 px desktop) so characters read the same size on every screen.
* **HUD** (game/HudScene.ts): dark glass cards, vector icons (art/icons.ts), segmented health bar, team scoreboard with
  progress to the score limit, framed minimap, kill-feed pills with weapon icons, banner announcer, death card, vignette.
  Touch controls sit in thumb zones and never overlap the HUD cards (unit-tested on a 915x412 phone).
* **Teams:** colour + shape (red = triangle marker, blue = circle marker); colour-blind presets swap the pair.
* **Palette tokens (UI):** ink #1b1d26, night #10121a, panel #1f2333, sun #ffd34d (primary), coral #ff7a45,
  mint #9cff6b, sky #5ad1ff, red team #ff5a4f, blue team #3fa2ff.
* **Type:** Baloo 2 (display, also Devanagari), Nunito (UI), Noto Sans Devanagari (Hindi body). All OFL. In canvas text the
  family must be quoted (`GAME_FONT`): an unquoted `Baloo 2` makes the whole font string invalid and the canvas silently
  falls back to 10px sans-serif.
* **Motion:** 120 / 200 / 320 ms, ease `cubic-bezier(.2,.8,.2,1)`; respect reduce-motion.
* **Icon:** cadet with yellow cap and jetpack flame on a dusk gradient (apps/game/public/icons/icon.svg).
