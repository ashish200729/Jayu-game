# Art style guide

**Look:** chunky, friendly cartoon soldiers with oversized heads, thick dark outlines (2 px at 1×, colour
`#1b1d26`), flat fills with one shade band, bright saturated palettes per map. Not stick figures, not gore:
deaths are a cartoon parts-burst with confetti.

* **Characters** (packages/client/src/art/characters.ts): separate parts drawn procedurally at 2× — head
  (helmet/hair variant), torso (outfit main/accent, team armband), legs + boots, arms, jetpack, gun. Proportions:
  head 20 px wide on a 44 px tall body; silhouettes readable at phone size. Every cosmetic swaps one part.
* **Weapons:** each gun has a distinct silhouette (length, magazine, scope, drum, coils, disc) drawn in light
  grey so weapon skins tint them; tracer colour per weapon.
* **Environments** (art/world.ts): 3 parallax layers per backdrop (far/mid/near silhouettes) over a sky gradient,
  rim-lit tile tops (`theme.rim`) and darker undersides so the play space always reads against the background.
  Liquids and vents animate; dark maps use a light-mask overlay lit by players, muzzle flashes and explosions.
* **Teams:** colour + shape (red = triangle marker, blue = circle marker); colour-blind presets swap the pair.
* **Palette tokens (UI):** ink #1b1d26, night #10121a, panel #1f2333, sun #ffd34d (primary), coral #ff7a45,
  mint #9cff6b, sky #5ad1ff, red team #ff5a4f, blue team #3fa2ff.
* **Type:** Baloo 2 (display, also Devanagari), Nunito (UI), Noto Sans Devanagari (Hindi body). All OFL.
* **Motion:** 120 / 200 / 320 ms, ease `cubic-bezier(.2,.8,.2,1)`; respect reduce-motion.
* **Icon:** cadet with yellow cap and jetpack flame on a dusk gradient (apps/game/public/icons/icon.svg).
