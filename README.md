# Terrarium — procedural bug genetics prototype

A vertical slice of the system: **gene vector → deterministic stats → breeding GA
→ 2D terrarium with physics, animation, and a real-clock day/night cycle.**

Stack: Phaser 3 + Matter.js, plain ES modules, no build step required for dev.

---

## The one rule

Stats are a **pure function of genes**. Nothing in the simulation ever writes
back into them.

```
genes ──► stats ──► physics params (velocity, mass, force)
   │         │  └──► animation rates (walk fps, bite rate)
   │         └────► fitness ──► selection
   └──────────────► sprite geometry (legs, body, mandibles, colour)
```

`computeStats()` takes no time, no randomness, no world state. The same genome
produces byte-identical stats forever — that's covered by a test.

---

## Run it

**Instant:** open `dist/terrarium.html`. One file, no server, no network — Phaser
is inlined.

**Dev:**

```bash
npm install        # only needed for the single-file build + tests
npm run dev        # serves on http://localhost:5173
npm test           # 14 tests over genes / stats / breeding
npm run build      # regenerates dist/terrarium.html
```

---

## Controls

| Action | How |
|---|---|
| Inspect a bug | click it — genes and stats appear in the panel |
| Breed one generation | `Breed` button, or `b` |
| Fast-forward N generations | `Fast-forward` (headless, then respawns) |
| New random population | `Reseed`, or `r` |
| Change selection pressure | the `fitness` dropdown |
| Watch a full day in minutes | `time scale` slider (1 = real time) |

---

## Layers

### 1. Genetics — `src/core/genes.js`, `genes.schema.json`

A genome is a flat object of 20 scalar genes. `GENE_ORDER` is the canonical
vector order — crossover, serialization, and any future GLB mapping all read it.

```
leg_count (int, even 4–10)   body_length     mandible_size        hue
leg_length                   body_width      mandible_serration   saturation
leg_thickness                body_mass       antenna_length       lightness
leg_spread                   carapace_thick  eye_size             pattern
                             wing_area       metabolism
                             wing_beat       aggression
```

Every write goes through `clampGene()`, so an illegal genome can't exist —
`hue` wraps, `leg_count` snaps to even, everything else clamps.

`aggression` is deliberately **not** a combat stat. It biases the behaviour
state machine only.

### 2. Stats — `src/core/stats.js`

`morphology(genes)` first derives physical quantities (mass, volume, leg length,
wing loading), then `computeStats()` turns those into gameplay numbers on a
0–100 scale:

`speed · agility · defense · attack · attackRate · health · stamina · recovery ·
flight · vision · camouflage · size`

Sample formulas:

- **speed** = stride × cadence, where stride grows with leg length and log(leg
  count), and cadence falls as mass-per-leg rises. More legs help — with
  diminishing returns.
- **defense** = sigmoid of shell volume over body surface. A thick shell on a
  small body is denser cover than the same shell on a big one.
- **attack** = sigmoid of mandible mass × serration, plus the body behind the
  bite. **attackRate** moves the opposite way — big jaws swing slower.
- **flight** = 0 below a wing-area threshold; above it, wing loading vs. beat rate.

Six fitness presets (`balanced`, `brawler`, `sprinter`, `tank`, `flier`, `ghost`)
are pure functions of stats, swappable live from the HUD.

### 3. Breeding — `src/core/breeding.js`

Textbook GA, no neural nets:

- **Crossover:** uniform, one-point, or BLX-α blend (default) — blend lets
  children land slightly outside the parents' interval, which keeps the search
  from stalling on interpolation alone.
- **Mutation:** Gaussian creep, per-gene probability `rate`, σ = `scale` × gene
  range. Integer genes step instead of drifting.
- **Selection:** tournament (default k=3) or roulette, with elitism 2 and 1
  random immigrant per generation to hold diversity up.
- **Diagnostics:** `geneDiversity()` returns mean normalized per-gene σ — 0 means
  the population has collapsed to clones.

All randomness runs through the seeded `mulberry32` in `src/core/rng.js`, so a
run is reproducible from its seed. `evolve(pop, n, opts)` runs headlessly for
tests and the fast-forward button.

### 4. Physics — Matter.js via Phaser

Each bug is a circle body. Stats set the parameters and nothing else:

| Stat | Physics parameter |
|---|---|
| `speed` | applied force magnitude + velocity cap |
| `agility` | `frictionAir` (low agility = more drag = wider turns) |
| `mass` | body mass, and knockback dealt |
| `attack`/`defense` | damage exchange on contact |
| `vision` | target acquisition radius |
| `camouflage` | how much that radius shrinks against *this* bug |

Rocks are static bodies; plants and food are decor. World gravity is off — this
is a top-down terrarium.

### 5. Animation — `src/sim/animator.js`

Frames are baked per genome at spawn: `idle` ×4, `walk` ×8, `attack` ×6, drawn
by `src/render/bugArt.js` onto a canvas strip and registered as a Phaser texture.
Legs are drawn as two-segment limbs with a per-pair phase offset, so a 10-legged
bug ripples and a 4-legged one stomps.

The FSM guards transitions; `attack` is a locked one-shot that returns to `idle`.
Playback rate comes from stats: walk fps ≈ `3 + speed × 0.22`, attack fps =
`6 frames × attackRate`.

### 6. Time — `src/sim/dayNight.js`

`dayFraction(new Date())` is the only clock. Eight colour/light keyframes are
interpolated into an ambient tint, applied as both a full-screen overlay and a
per-sprite tint (blended toward white so bugs stay legible after dark).

`behaviourAt(t)` also returns gameplay modifiers the sim reads each frame:
`activity` (bugs are sluggish in the dark, restless at dusk), `aggressionBias`
(+35% at night), and `stealthBonus` (camouflage matters more in low light).

`timeScale` is a debug lever only — at 1 it is exactly real time.

---

## Tests

`npm test` — 14 tests, all passing:

- RNG determinism; genome range/quantisation invariants over 500 random genomes
- Stats identical across 50 recomputes; finite and bounded over 2000 genomes
- Monotonicity: thicker carapace ⇒ more defense; bigger mandibles ⇒ more attack
  but slower swing; longer legs ⇒ more speed
- Crossover and mutation children always legal
- Elitism ⇒ best fitness never regresses (checked for all six presets, 25 gens)
- Selection ⇒ mean fitness up >15% over 40 generations
- Evolution reproducible from a seed; immigrants prevent clone collapse

---

## Files

```
index.html                 dev entry (Phaser from CDN)
dist/terrarium.html        self-contained build — just open it
src/core/rng.js            seeded mulberry32
src/core/genes.js          gene specs, clamping, vector I/O, ids, names
src/core/genes.schema.json JSON Schema for the genome
src/core/stats.js          morphology + pure stat formulas + fitness presets
src/core/breeding.js       crossover, mutation, selection, generation loop
src/render/bugArt.js       procedural canvas art + spritesheet baking
src/sim/animator.js        animation state machine
src/sim/dayNight.js        real-clock day/night + behaviour modifiers
src/sim/bug.js             entity: stats -> body, animator, behaviour
src/sim/terrarium.js       Phaser scene, decor, generation control
src/main.js                boot + HUD
tests/core.test.js         genetics/stats/breeding tests
tools/build-single.mjs     bundles + inlines into dist/terrarium.html
```

---

## The 3D seam

`src/render/bugArt.js` is the only module that knows what a bug looks like.
`layout(genes)` already produces the skeleton the anyCreature spec will need —
segment positions and radii, per-leg attach points, splay, and lengths. Swapping
in the JSON-spec → rigged-GLB pipeline means writing a
`genes → anyCreature spec` mapper against `layout()` and replacing
`bakeSpritesheet` with a mesh loader. Nothing in `core/` or `sim/` changes.

---

## Known rough edges

- Fitness converges fast (~10 generations) because the presets are smooth and
  the search space is small. Lower `tournamentK` or raise `immigrants` to slow it.
- Food pellets are drawn but not edible yet — energy only regenerates from rest.
- Downed bugs stay on the field as static props until the next generation.
- Combat is contact-only; there's no ranged or ambush behaviour beyond the
  camouflage detection penalty.

---

## Responsive layout

The terrarium reshapes itself to the screen rather than letterboxing a fixed
1280×800 world into whatever's available.

**World sizing** — `src/sim/viewport.js` computes world dimensions from the
viewport's aspect ratio at *constant area*, so a portrait phone gets a tall
terrarium and a desktop gets a wide one, while bugs stay the same relative size
in both. Aspect is clamped to 1:2 … 12:5 so extreme windows don't get silly.

**Layout modes**

| Screen | Layout |
|---|---|
| ≥ 860px wide | canvas + fixed 330px side panel |
| narrow / portrait | full-bleed canvas + collapsible bottom sheet |
| short landscape (≤ 430px tall) | canvas + slim 268px rail |

The bottom sheet is a real reservation, not an overlay — `#stage` reserves its
height so the terrarium is never hidden behind it. Tap the grab bar to collapse;
tapping a bug auto-expands the sheet to show its genes.

**Device tiers** drive population and decor density, keyed on the *short* edge so
rotating a phone doesn't reclassify it: phone (< 480px) 7 bugs, tablet (< 900px)
10, desktop 12. Moving the population slider pins your choice and stops the tier
default from overriding it.

**Why a ResizeObserver** — watching `window.resize` alone measured the canvas host
mid-transition and locked in the wrong aspect. Observing the host element catches
window resizes, orientation flips, iOS toolbar slides, *and* the tail of the
sheet animation.

### Safari / iOS specifics

- `100dvh` with `100vh` and `-webkit-fill-available` fallbacks — plain `vh` is
  wrong whenever iOS Safari's toolbars are showing
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding for notches
- `overscroll-behavior: none` kills pull-to-refresh and rubber-banding
- `touch-action: none` on the canvas, `manipulation` on controls — no 300ms tap
  delay, no double-tap zoom
- range inputs draw an explicit full-height track; a 4px WebKit track clips the
  thumb into a half-dome
- 40px minimum control height, 44px slider rows, 24px thumbs on coarse pointers
- the sim pauses on `visibilitychange` so a backgrounded tab stops burning battery

### Verification

`npm run test:viewport` checks six viewports (iPhone SE / 14 / Pixel 7 portrait,
iPhone landscape, iPad, desktop) for console errors, canvas fit, page overflow,
offscreen or undersized controls, and **panel-over-canvas occlusion**.
`npm run test:interact` exercises sheet toggling, rotation both ways, and tapping
the controls.

> **Tested in Chromium only.** WebKit couldn't be installed in the build
> environment, so the Safari-specific CSS above is written to spec but has not
> been run on a real WebKit engine. Worth a quick look on an actual iPhone.
