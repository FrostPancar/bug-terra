# The bug builder — `tools/builder.html`

A workshop for the gene vector. Load a taxon or an archetype, tap parts on and
off, drag the genes that drive them, and export the combination as code.

## Two ways to run it

**Served** — imports the live `src/` modules, so it can never drift from the game:

```bash
npm run dev                      # serves the repo root on :5173
# then open  /tools/builder.html
```

`tools/builder.html` also stages to `deploy/builder.html`, where the same file
resolves `./src/` instead of `../src/`.

**As one file** — no server, no network, nothing to install:

```bash
npm run build:builder            # -> dist/builder.html  (~133 kB)
```

Then double-click `dist/builder.html`, or open it from `file://`. The bundler
inlines every module it needs onto `globalThis.BUGSIM` and the page prefers that
over fetching. A `file://` page cannot fetch ES modules, which is why the served
copy alone will not open off disk — it shows a message telling you which of
these two to use rather than a blank panel.

Note what that trade means: the single file is a **snapshot**. Rebuild it after
touching genes, art, classification or the part catalogue, or it will quietly
describe the old renderer. The served copy has no such problem.

Either way the preview is `bugArt.js`, the bars are `computeStats()`, and the
label is `classify()`. There is no second copy of any of it.

The tool is a dev surface, so unlike the HUD it is allowed to show numbers.
`tests/hidden.test.js` scans `src/ui/` and `src/main.js` for that vocabulary;
nothing here is in either.

---

## The three things it does

### 1. Default builds — `src/core/taxonBuild.js`

`classify()` reads a genome and names it. `buildForTaxon()` goes the other way,
and it is not a search:

1. **Intersect** every window from the root down to the taxon. `Rhinoceros
   Beetle` inherits Beetle's `body_mass ≥ 0.55` on top of its own.
2. **Pick the closest archetype** — the one already missing the fewest
   constraints. A Stag Beetle built off the beetle plan looks like a beetle; one
   built off the moth plan looks like a mistake.
3. **Snap only the genes that miss**, to the middle of their window rather than
   its edge — an edge value is one breeding step out of the taxon it was built for.
4. **Walk back out of deeper windows.** The snapped genome often satisfies a
   child too, and `descend()` always takes the deepest match, so asking for a
   Wasp handed back a Swift Flier. The build now pushes one gene at a time out
   of the deeper window, never touching a gene the target itself constrains.

Every taxon whose windows are satisfiable classifies as *itself* — asserted for
all 31 nodes in `tests/parts.test.js`.

#### When a taxon cannot be built, the tool says so

A child window that contradicts its parent's is unreachable by **any** genome,
because `classify()` only reaches a node if every ancestor's window is satisfied
too. `mergedWindow()` intersects the path, so the builder can report the exact
clash — which gene, which two nodes, which two ranges — instead of quietly
handing back the parent and letting you wonder why the taxon never sticks.

Writing this catalogue turned up three live ones, all since fixed in
`CLASS_TREE`: Ground Beetle asked for `leg_length ≥ 0.60` under a Beetle capped
at `0.45`, Firefly for `body_mass ≤ 0.35` under a Beetle floored at
`0.55`, and Butterfly for `setae ≤ 0.30` under a Moth floored at `0.75`. One was
a window that belonged inside its parent's; the other two were concepts that
negate their parent, and are now siblings that keep `order` while hanging off
`larva`.

Two knock-ons came out of that fix, both measured against a 4,000-genome sample
rather than argued from the windows:

- Ground Beetle's carapace was *also* drafted at `[0.35, 0.6]`, which merged with
  Beetle's `[0.55, 1]` down to a 0.05-wide slice. Legal, so the conflict check
  never flagged it — but far too narrow for a lineage to ever breed into. The
  check catches contradictions, not windows that are merely vanishing.
- Once the Firefly was standing at tier 1 on three loose genes it started taking
  genomes off the Wasp, and a bug with a stinger is better described by its
  stinger than by its markings. Pinning `wing_type: 1` — elytra — settled it:
  hard wing cases are what still make a firefly a beetle underneath, and
  categorically what a wasp does not have. Firefly went from 127 draws per 4,000
  to 66, and the Wasp got its genomes back.

The check is recomputed at load, not baked in: author a new contradiction and it
shows up immediately as a ⚠ in the taxon list, a red **unreachable** note under
the build button, and a **never** badge beside that taxon in the drift line.

### 2. The part library — `src/render/partLibrary.js`

The **Part library** and **All 55 genes** tabs cut the same data two ways. The
library is organised by *what you see on the bug* — 23 things the renderer can
draw, each owning the two to six genes that shape it, with the threshold where
it appears, a thumbnail per kind, and a grid tile framed on the part itself
(`FOCUS` in `partLibrary.js` says how each one is framed: the pose is head-up,
so a positive `y` brings the head into the tile and a negative one the tail). The gene tab is organised by *the vector* —
all 55 in `GENE_ORDER`, including the three that reach no part of the sprite, each
saying which parts it feeds. Start in the library when you are building a bug;
go to the genes when you need one specific dial, or the ones no part exposes.

`bugArt.js` knows how to draw a bug. Nothing else knew *what* it draws, so the
only way to find out whether `spine_density` put anything on the sprite was to
read 800 lines of canvas code. The catalogue writes that down once: 23 parts,
the genes behind each, and the exact threshold at which each appears.

Two rules keep it honest, both enforced by `tests/parts.test.js`, which renders
through a recording stand-in for a 2D context and compares the call log:

- Every gate is the **real expression** from `bugArt.js`. A part that claims to
  be drawn must change the canvas calls when it is added.
- A gene that feeds stats but puts nothing on the sprite is marked **stats only**
  and says what it really does. A gene marked that way must leave the render
  byte-identical across its whole range.

That second test already caught one wrong claim: `body_segments` looked like a
stat-only gene and is not — it stretches the whole body through `morphology()`.


### Body — the masses everything else mounts on

| Part | Appears when | Genes |
|---|---|---|
| **Body plan** | _always on_ | `leg_count`, `body_segments` |
| **Abdomen** | `body_segments ≥ 2` | `body_segments`, `abdomen_width`, `abdomen_length`, `body_width`, `abdomen_taper` |
| **Thorax** | _always on_ | `thorax_width`, `thorax_length`, `body_width` |
| **Head** | _always on_ | `head_width`, `head_length`, `body_width` |
| **Trunk segments** | `body plan is myriapod; count = clamp(body_segments, 6, 10)` | `body_segments`, `leg_count` |

### Limbs — legs and what is on the end of them

| Part | Appears when | Genes |
|---|---|---|
| **Legs** | _always on_ | `leg_count`, `leg_length`, `leg_thickness`, `leg_spread`, `leg_joints` |
| **Feet** | always drawn (core), at a fixed 0.95 of the leg width | `leg_thickness` |

### Wings — four kinds fan, one kind covers

| Part | Appears when | Genes |
|---|---|---|
| **Wings** | `wing_count > 0 && wing_area > 0.05` | `wing_count`, `wing_type`, `wing_area`, `wing_length`, `wing_width`, `wing_roundness`, `wing_angle`, `wing_tip_hue`, `wing_beat` |

### Weapons — the front end and the back end

| Part | Appears when | Genes |
|---|---|---|
| **Horn** | `horn_size ≥ 0.12` | `horn_size`, `horn_type`, `pattern_horn`, `pattern_horn_hue`, `pattern_scale`, `pattern_contrast` |
| **Horn serration** | `horn_serration ≥ 1, and the horn must be drawn at all (horn_size ≥ 0.12). NEVER on crown (horn_type 4)` | `horn_serration`, `horn_type`, `horn_size` |
| **Mandibles** | `mandible_size ≥ 0.10` | `mandible_size`, `mandible_type`, `mandible_serration`, `pattern_mandible`, `pattern_mandible_hue`, `pattern_scale`, `pattern_contrast` |
| **Tail** | `tail_length × 0.44 > 0.08  →  tail_length > 0.182` | `tail_length`, `stinger_size` |
| **Stinger** | `stinger_size > 0.18, and the tail must be drawn at all` | `stinger_size`, `tail_length` |

### Sensory — eyes and antennae

| Part | Appears when | Genes |
|---|---|---|
| **Eyes** | _always on_ | `eye_size`, `eye_type`, `eye_count`, `saturation` |
| **Crown mark** | `crown_mark_style` ≥ 1 | `crown_mark_style` |
| **Extra eyes** | `eye_count ≥ 4  (extra pairs = clamp(round(eye_count / 2) − 1, 0, 3))` | `eye_count`, `eye_size` |
| **Antennae** | `antenna_length > 0.104  (the length has to clear 0.15 of the body unit)` | `antenna_length` |

### Surface — colour, pattern, fur

| Part | Appears when | Genes |
|---|---|---|
| **Shell colour** | _always on_ | `hue`, `saturation`, `lightness` |
| **Ink limbs** | `pattern_leg > 0.5` | `pattern_leg` |
| **Horn & jaw pattern** | `a horn or a mandible has to be drawn (horn_size ≥ 0.12 or mandible_size ≥ 0.10); mode = min(4, floor(pattern_horn × 5)) for the horn, the same over pattern_mandible for the jaws` | `pattern_horn`, `pattern_mandible`, `pattern_scale`, `pattern_contrast` |
| **Segment lighting** | always drawn (core) | `light_hue`, `lighting_lightness`, `lighting_saturation`, `lightness` (as the floor only), `body_segments` |
| **Setae** | `setae ≥ 0.35` | `setae` |
| **Segment spikes** | `spikyness > 0.02` | `spikyness`, `translucency` |

#### Genes that move numbers, not pixels

Three of the 55 reach no part of the sprite. The builder badges them rather
than leaving you to wonder why the slider does nothing:

`body_mass` · `metabolism` · `aggression`

`carapace_thickness`, `spine_density` and `body_length` are gone outright —
not merged into this list, removed from the genome entirely. `body_mass` now
carries carapace_thickness's old defense/health/shell role as well as its own,
blended a minority share with a derived body-size coefficient (see
`bodySize()` in `stats.js`); `spine_density`'s defense role folded the same
way and its classification role (Centipede, Millipede) moved to `spikyness`,
which is the same idea with real art behind it — see **Segment spikes** above.
`body_length` was never a body dimension to begin with; `body_size` replaces
it as a value derived from the actual part genes, not a gene of its own.

### 3. Export

| Format | What it is |
|---|---|
| **JS genome** | the full 57 genes as a `normalizeGenome({...})` literal, grouped and commented |
| **JSON** | the raw genome object |
| **Patch vs base** | only the genes you changed since loading the build — the parameter combination on its own |
| **Archetype entry** | a `{ key, name, blurb, spread, bias }` block ready to paste into `ARCHETYPES` |
| **Share link** | one byte per gene in `GENE_ORDER`, base64url — a 57-character code in the URL hash, with its decoder |

The URL hash updates on every edit, so a build is reloadable and shareable
without a save file. The share code quantises to 1/255 of each gene's range;
round-tripping it moves no gene by more than 0.002 and never changes the taxon.

---

## Using it

- **The library is the left column and the bug is the right one**, so a tap and
  what it did are on screen together. Below 1000px they stack, and a pinned
  92px copy of the preview follows you down the list — tap it to jump back up.
- **The library is a grid of the parts themselves.** Every tile is *your* bug
  framed on that one part — the horn tile is the horn you actually have, at the
  size and kind you set. A part the bug does not carry yet is drawn as it would
  look if added, hatched and dimmed so the state stays unambiguous.
- **Tap a tile to expand it** into the full view: blurb, the gate, the render
  function, the kinds, and a slider per gene. One section is open at a time —
  an expanded part spans the grid, and two of them bury the catalogue.
- **The corner pill adds or removes** without opening anything: `+` for a part
  the bug lacks, `−` for one it has, a grey dot for a part that is always on,
  and purple for one that only moves numbers.
- **Variant thumbnails** are the current bug with only that kind swapped, so the
  five horns are compared on your animal rather than on a stock one.
- **Sliders** redraw live and re-check every gate on release, so a part can
  appear or vanish under you as you drag. That is the point: the gate is the
  interesting part of the gene.
- The stage shows what the genome classifies as, its clade brackets, its flat
  traits, and the two nearest taxa it has **not** reached with the gene each one
  is waiting on.

---

## Extending the catalogue

Adding a part to `bugArt.js` means adding an entry to `PARTS` in
`partLibrary.js` — id, group, blurb, the `gate` string copied from the render
condition, the genes with what each does, and `on` / `off` patches. If the gate
is wrong or the gene list has a typo, `tests/parts.test.js` fails; nothing has to
be wired into the builder itself.
