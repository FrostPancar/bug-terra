# Terrarium — procedural bug genetics prototype

A vertical slice of the system: **gene vector → deterministic stats → breeding GA
→ 2D terrarium with physics, animation, and a real-clock day/night cycle.**

Stack: Phaser 3 + Matter.js, plain ES modules, no build step required for dev.

---

## The one rule

Stats are a **pure function of genes**. Classification is a second, equally pure
read. Nothing in the simulation ever writes back into either.

```
genes ──┬──► stats ──► physics params (velocity, mass, force)
        │       │  └──► animation rates (walk fps, bite rate)
        │       └────► fitness ──► selection
        ├──► classification ──► identity, specialty multipliers, breeding locks
        └──► sprite geometry (legs, body, mandibles, colour)
```

`computeStats()` and `classify()` take no time, no randomness, no world state.
The same genome produces byte-identical results forever — both are covered by
tests that recompute and compare.

## The second rule

**The player never sees a number.** Stats and genes are hidden; you learn a bug
by watching it, fighting it, and taking it to the Vet Station. See
[HIDDEN.md](HIDDEN.md) — and note that this is enforced by a test that scans the
UI sources, not just by convention.

---

## Run it

**Instant:** open `dist/terrarium.html`. One file, no server, no network — Phaser
is inlined.

**Dev:**

```bash
npm install        # only needed for the single-file build + tests
npm run dev        # serves on http://localhost:5173
npm test           # 147 tests over genes / stats / breeding / classification /
                   # parts / objects / world / hidden / session
npm run build      # re-embeds src/assets/ and regenerates dist/terrarium.html
```

**The builder:** with a dev server on the repo root, open
`/tools/builder.html` — it imports `src/` live, so it can never drift from the
game. For a copy that opens straight off disk with no server:

```bash
npm run build:builder     # -> dist/builder.html, self-contained, 133 kB
```

Load a taxon or an archetype, tap parts on and off, drag the genes, and export
the combination as code — see [BUILDER.md](./BUILDER.md).

---

## Controls

The HUD shows three verbs and three numbers. Everything else is one tap down,
inside a section you open on purpose — see [Modes](#modes) below.

| Action | How |
|---|---|
| Inspect a bug | click it — you get what you've earned, in words |
| See what a bug actually is | `Vet` on the bug card — visually only |
| Breed one generation | `Breed` in the dock, or `b` |
| Put something in the terrarium | `Build` → pick a category → pick a thing → tap the floor |
| Go underground | `Burrow`, `Send down` on the bug card, or tap a placed entrance |
| Come back up | `Surface` / `Come back up`, or `Esc` |
| Fast-forward N generations | `Breeding` section → `Fast-forward` |
| Change selection pressure | `Breeding` section → the `breeding for` dropdown |
| Watch a full day in minutes | `Terrarium` section → `time scale` (1 = real time) |
| New random population | `This run` → `New population`, or `r` |
| Throw the run away | `This run` → `Start over` — it asks first |

### Modes

Three, and one state machine — `src/ui/modes.js` — owns the moves between them.

```
WATCH ──[Build]──▶ BUILD ──[pick a thing]──▶ PLACE ──[tap the floor]──┐
  ▲                  │  ▲                      │  (stays armed, so    │
  │                  │  └────────[Back]────────┘   you can place      │
  ├──────[Done]──────┴─────────────────────────────  several)  ◀──────┘
  │
  └──[Surface]── BURROW ◀──[Burrow]── needs a placed Burrow Entrance + a bug
```

The gate is deliberate: the dirt zone is reached **through a thing you built**.
Asking to burrow with no entrance does not refuse — it drops you into the build
menu already holding one. In the scene, the same three modes decide what a tap
means: steer, place, or select a bug (`TerrariumScene.handleClick`).

---

## Layers

### 1. Genetics — `src/core/genes.js`, `genes.schema.json`

A genome is a flat object of **41 scalar genes** across six groups — body plan,
limbs, wings, weapons/defence, sensory, and surface/colour. Four of them
(`wing_type`, `mandible_type`, `horn_type`, `eye_type`) are categorical "kind"
genes rather than continuous amounts. `GENE_ORDER` is the
canonical vector order; crossover, serialization and any future GLB mapping all
read it.

**[GENES.md](./GENES.md) is the full reference** — every gene, its range, what it
drives, and the eight starting archetypes.

Generation 0 is seeded from archetypes (beetle, wasp, spider, roach, mantis,
moth, centipede, weevil) rather than uniform random, so the pool starts visibly
diverse instead of converging on mid-range blobs. 15% of each pool is drawn at
random as wildcards. Archetypes are starting points, not classes — nothing in
the sim branches on them, and after one crossover the lineages blend.

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

Seven fitness presets (`balanced`, `brawler`, `sprinter`, `tank`, `flier`,
`ghost`, `venomous`)
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

**What the terrarium feeds in.** `breedingModifiers()` reads the structures
covering the breeding site at the moment the call runs, and `breedGeneration()`
now consumes all of it:

| Field | What it does |
|---|---|
| `rate` | generational turnover. Below 1 part of the pool rides through unchanged (a Cave is a slow cadence, not a worse one); above 1 even the elites get bred out. At exactly 1 the algorithm is byte-identical to what it was. |
| `selection` | `'inverse'` — the Compost Heap breeds from the worst |
| `mutationScale` | the Crucible's high-variance gamble |
| `fitnessBonus` + `favoured` | the Mushroom Ring. Applied **only** to the bugs standing in it — a bonus everyone gets cancels out of a tournament and changes nothing |
| `eligible` | who may parent at all. A Pollen Bloom requires the Winged trait; a Cave waives every requirement. If nothing qualifies, the call **refuses** and the generation does not advance |
| `bypassSelection` + `pair` | the Nest, which bonds two bugs with no tournament in front of them |
| `growthRate` | a well-planted plot supports a bigger brood, a starved one fewer |

Only the scene knows where each bug is standing, so it decides eligibility and
who was in the ring and hands indices down. `breedGeneration` stays a pure
function of its arguments.

All randomness runs through the seeded `mulberry32` in `src/core/rng.js`, so a
run is reproducible from its seed — and `rng.state()` lets a saved run resume
the exact same stream rather than silently restarting it. `evolve(pop, n, opts)`
runs headlessly for tests and the fast-forward button.

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

World gravity is off — this is a top-down terrarium. There are no rock bodies
any more: the floor is a photograph and the stones in it are in the image, so
colliding with them would mean colliding with something the renderer never drew.

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

### 7. Objects and plants — `src/sim/objects.js`, `src/sim/plants.js`

Placeable structures and a plant lifecycle FSM (seed → sprout → growing →
mature → spreading → declining → dead → cleared plot), gated by three upkeep
meters (hydration, light, nutrients). **No object ever writes a gene or a
stat** — a Grass Patch contributes a growth multiplier that breeding reads at
the moment it runs, never an edit to an existing bug. See
[OBJECTS.md](./OBJECTS.md).

Standing inside a trainer's radius for a full session calls
`Knowledge.trained()` — the third of the concept doc's three ways to learn a
bug, and the only route to a `grip` phrase, since you cannot learn how well
something plants itself by watching it. An Obstacle Course has to be *run*, not
stood in. The gain lands on that one bug's derived stat block and never on its
genome, which is exactly what "trains base stats directly, genes stay where they
were" means; a Feeding Trough's wears off on a timer, a Training Rock's stays.

### 8. Persistence — `src/sim/save.js`

One versioned JSON blob in `localStorage`, written on a debounce and flushed on
`visibilitychange`, `pagehide` and `beforeunload`. It carries the seed, the rng
position, the generation, the live population, the preset, and every knowledge
record.

This is what makes the day/night cycle mean anything. The clock was always real,
but before this a reload discarded the whole run — which is a strange thing to
do to a design that asks the player to spend attention on an animal before it
will tell them anything about it. Restored genomes go back through
`normalizeGenome`, so a hand-edited or stale save cannot smuggle an illegal
animal past the one rule. No storage at all is a supported state: the panel says
so plainly rather than losing an hour of watching quietly.

### 9. World — `src/world/`

Per-player terrariums on a shared grid, connected by a destructible dirt zone.
`DirtWorld` is the client half — predict locally, apply ops, reconcile —
against a `LocalAuthority` stand-in that runs in-process; a real transport
swaps in as one object. Chunks are implicit-solid until first dig, so an
untouched dirt zone costs zero bytes. See [WORLD.md](./WORLD.md).

`src/sim/burrow.js` is how you actually get in there: place a Burrow Entrance,
send a bug down it, and drag to steer. Dig radius and cadence come off `grip`,
`attack` and `attackRate`, so a bug that was already good is already good
underground — no fifteenth stat. Finds come back as sentences, never as loot
counts.

---

## Tests

`npm test` — **134 tests**, all passing, across six files:

| File | Covers |
|---|---|
| `core.test.js` | genes, stats, breeding, archetypes (20) |
| `classification.test.js` | the taxonomy tree and the hybrid seam (21) |
| `plants.test.js` | plant lifecycle, meters, objects (20) |
| `world.test.js` | chunks, ops, grid, gates, discovery (29) |
| `hidden.test.js` | the no-numbers rule, impressions, knowledge, vet (21) |
| `session.test.js` | persistence, the training channel, breeding modifiers (23) |

Highlights beyond the original genetics suite:

- **Classification is pure and total** — 20 recomputes per genome match exactly;
  400 random genomes all land on a real node with a valid parent chain
- **The Beetle ⇄ Moth wall holds** — no genome satisfies both windows, and
  walking `wing_area` between them passes through a genuine gap
- **The hybrid seam works** — a Beetle bred to eight legs stays a Beetle chassis
  on an arachnid body and is named accordingly, rather than becoming a Spider
- **Plants never touch genetics** — `plants.js`'s imports are inspected and the
  source is scanned for `computeStats`, `clampGene`, `GENE_ORDER`, `genome`
- **Dig ops are idempotent and order-independent**; an untouched dirt zone
  occupies zero bytes; a long-abandoned hole closes and forgets its chunk
- **The UI cannot render a number** — `main.js` and `src/ui/` are scanned for
  gene/stat imports, `snapshot()` for a leaked genome or stat block, and every
  impression phrase for a digit
- **A run round-trips**, a corrupt save starts fresh instead of crashing into a
  broken one, a save from another version is ignored, and no storage at all is a
  supported state rather than an error
- **`rate 1` is byte-identical to the old algorithm**, so wiring the modifiers in
  could not quietly change breeding for anyone who has no structures placed
- **A gate nothing satisfies refuses** and leaves the pool exactly as it was,
  instead of breeding anyway
- **A fitness bonus lifts only the favoured** — with nobody favoured it cannot
  reorder the pool at all

Browser matrices (need a static server on `:8899`):
`npm run test:viewport` (6 viewports, occlusion-checked) and
`npm run test:interact`.

### The original genetics suite

- RNG determinism; genome range/quantisation invariants over 500 random genomes
- Stats identical across 50 recomputes; finite and bounded over 2000 genomes
- Monotonicity: thicker carapace ⇒ more defense; bigger mandibles ⇒ more attack
  but slower swing; longer legs ⇒ more speed
- Crossover and mutation children always legal
- Elitism ⇒ best fitness never regresses (checked for all six presets, 25 gens)
- Selection ⇒ mean fitness up >15% over 40 generations
- Evolution reproducible from a seed; immigrants prevent clone collapse
- Every archetype yields a legal genome and finite stats
- Archetypes stay distinguishable: every headline stat spans >25 points across
  the set, and no two sit within 20 units of each other in stat space
- Seeded pools are diverse, and `nearestArchetype` classifies >85% back correctly
- New genes drive their stats: no stinger ⇒ zero venom, no wings ⇒ zero flight,
  spines ⇒ defense, horn ⇒ attack, claws ⇒ grip, more eyes ⇒ vision,
  iridescence ⇒ *less* camouflage

---

## Files

```
index.html                 dev entry (Phaser from CDN)
dist/terrarium.html        self-contained build — just open it
src/core/rng.js            seeded mulberry32
src/core/genes.js          gene specs, clamping, vector I/O, ids, names
src/core/archetypes.js     eight body plans + seeding + nearest-archetype label
src/core/genes.schema.json JSON Schema for the genome
src/core/stats.js          morphology + pure stat formulas + fitness presets
src/core/classification.js clade brackets + taxonomy tree (second pure read)
src/core/taxonBuild.js     the inverse of classify(): taxon -> a genome that is one
src/core/impressions.js    stats -> words; the no-numbers vocabulary
src/core/breeding.js       crossover, mutation, selection, generation loop
src/render/bugArt.js       procedural canvas art + spritesheet baking
src/render/partLibrary.js  every part the renderer draws + the genes behind each
src/sim/animator.js        animation state machine
src/sim/dayNight.js        real-clock day/night + behaviour modifiers
src/sim/bug.js             entity: stats -> body, animator, behaviour
src/sim/knowledge.js       what the player has earned + the Vet Station
src/sim/save.js            the run, kept across reloads
src/sim/objects.js         placeable object catalog + field aggregation
src/sim/plants.js          plant lifecycle FSM + three upkeep meters
src/sim/burrow.js          burrow mode: the dirt zone, dug and drawn
src/sim/terrarium.js       Phaser scene, decor, garden, generation control
src/world/chunks.js        dirt-zone chunks, dig/fill ops, regrowth, POIs
src/world/grid.js          cell topology + spiral assignment
src/world/gates.js         gateOpen / pvpEnabled and the entry rules
src/world/discovery.js     falloff curve, dig power, borrowed holes
src/world/index.js         DirtWorld client + LocalAuthority stand-in
src/ui/chrome.js           flat control behaviour (press, pause, toasts, bump)
src/ui/build.js            the two-step build menu over the object catalog
src/ui/modes.js            watch / build / place / burrow — the state machine
src/assets/dirt.jpg        the floor photograph
src/assets/dirt.js         GENERATED data URI — see tools/embed-assets.mjs
src/main.js                boot + HUD (cannot render a number)
GENES.md                   full gene and archetype reference
TAXONOMY.md                the classification tree, and what it resolved
BUILDER.md                 the bug builder tool and the part catalogue
OBJECTS.md                 terrarium objects + the plant upkeep loop
WORLD.md                   multiplayer world, dirt zone, sync authority
HIDDEN.md                  the no-numbers rule and how it's enforced
CONCEPT.md                 the plain-language pitch, no source-reading required
DEPLOY.md                  build + deploy notes
THIRD-PARTY.md             ported/vendored code and licences
tests/*.test.js            147 tests across seven files
tools/build-single.mjs     bundles + inlines into dist/terrarium.html
tools/builder.html         the bug builder — taxon builds, part library, export
tools/build-builder.mjs    inlines the builder's modules -> dist/builder.html
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
- Plants still accumulate `pendingYield` that nothing harvests — energy only
  regenerates from rest. `harvest()` exists and has no caller.
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
in both. Aspect is clamped to ~1:2.2 … 12:5 so extreme windows don't get silly —
the low end sits at 0.45 rather than 0.5 so today's tall phones (~0.46) fill the
stage instead of letterboxing against it.

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
>
> The Playwright matrices also need `npx playwright install chromium`; without
> the browser binary they fail to launch rather than reporting a failure.

---

## The look: cut paper on a photograph

The floor is a real photograph of dirt — `src/assets/dirt.jpg` — and every rock,
pebble and fleck of grit you can see is *in the image*. The scene draws none of
them. The procedural scatter that used to sit there laid flat grey circles on
top of photographed stones, which read exactly as badly as it sounds; deleting
it removed a whole class of decor code and made the floor better at the same
time.

The photo is embedded as a data URI by `tools/embed-assets.mjs` and imported as
a module. That keeps the headline of the single-file build honest — open
`dist/terrarium.html` and there is still no server and no network — and it means
dev, bundle and deploy all take exactly one code path to the same bytes. The
`.jpg` stays the source of truth; `src/assets/dirt.js` is generated and should
never be hand-edited.

Everything drawn on top follows the bugs' own rules: **filled shapes, no
outlines, no gradients, and one shadow — a solid offset, never a blur.** The
palette lives twice, once as CSS custom properties in `index.html` and once as
`PALETTE` in `src/sim/terrarium.js`, because the canvas and the DOM need it in
different formats; both are pulled off the photograph and the bug art rather
than invented beside them.

Every control is one control: a **filled rounded rectangle, bold Helvetica,
uppercase, one hard offset shadow**, at a different size and colour depending on
what it does. There is no second button style anywhere — the dock, the panel
sections, the build tiles and the mode banner are all that shape.

The chrome is three things and no more:

| Where | What |
|---|---|
| top left | one card: time of day, generation, how many are still standing |
| top right | pause |
| bottom | Breed · Build · Burrow — replaced by a mode banner while placing or underground |

Those three numbers are the **only** numbers the game shows, and every one of
them is about the run rather than about any animal — the no-numbers rule is
untouched, and `tests/hidden.test.js` still enforces it. The day/night phase is
a coloured dot on the card as well as a word, because the sky's own colour is
nearly white at midday and disappears against paper.

### What a first launch shows

The rule for the panel is that a player who has just arrived should see the
terrarium, the animal they tapped, and the three things they can do. So:

- The **bug card** is the panel, and the two things you can do to a bug — take
  it to the vet, send it down — are *on* it rather than in a block of their own.
- Tuning (`breeding for`, fast-forward, population, time scale), the seed, and
  starting over are inside three closed accordions. Each holds a whole job.
- Lines that cannot say anything yet do not appear at all. "Too early to say"
  and "nothing to compare yet" were the pool trend and spread with no history
  behind them; they now show up at generation two, when they mean something.
- The build catalog is twenty-seven things, shown as six categories that open
  into four or five. One flat list is a catalogue; two steps is a decision.

Structures on the floor are drawn as damp worked earth with a wash of their
category's colour, not as solid discs — at full opacity they read as stray UI
someone left lying on the photograph. The Burrow Entrance is the exception and
is drawn as what it is: a dark mouth with a yellow lip, because it is a hole
rather than a marking, and because you have to be able to find it to tap it.

### What happened to the glass

`src/ui/glass.js` — the vanilla port of `@samasante/liquid-glass` — **has been
removed**, along with the multiply scrim the dark panel needed. A lens that
refracts the live scene behind a button is a genuinely nice instrument, and it
is the wrong one for this design: there is no dark scene left to dissolve a
panel into, and a glass dome in the middle of flat cut paper reads as a control
surface borrowed from another app.

`src/ui/chrome.js` replaces it and is much smaller: press feedback that survives
a touch (`:active` is unreliable on iOS), the pause button's two states, and the
squash the generation badge does when it changes. The panel is now an opaque
sheet of paper with a rounded top and the same hard shadow every other control
carries.
