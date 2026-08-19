# Gene and archetype reference

The pool went from **20 genes to 37**, and generation 0 is now seeded from eight
body-plan archetypes instead of uniform random noise.

Every gene below is a scalar on a fixed range, clamped on every write — an
illegal genome cannot exist. `GENE_ORDER` (the key order in
`src/core/genes.js`) is canonical: crossover, serialization and any future
GLB mapping all read it.

---

## The 37 genes

### Body plan — 8

| Gene | Range | What it does |
|---|---|---|
| `body_segments` | int 2–4 | Abdominal tergites. More segments stretch the body and add health. |
| `body_length` | 0–1 | Overall length. |
| `body_width` | 0–1 | Overall width. |
| `body_mass` | 0–1 | Density, independent of volume. Heavy bugs hit harder and turn worse. |
| `head_size` | 0–1 | Head capsule. Sets where the eyes and mandibles mount. |
| `thorax_ratio` | 0–1 | Trades thorax length against abdomen length. |
| `abdomen_taper` | 0–1 | 0 = round, 1 = pointed. A tapered abdomen carries less volume. |
| `carapace_thickness` | 0–1 | Shell. The single biggest defense input. |

### Limbs — 6

| Gene | Range | What it does |
|---|---|---|
| `leg_count` | int 4–10, even | Legs. Raises stride with diminishing returns (log₂). |
| `leg_length` | 0–1 | Femur + tibia relative to body. |
| `leg_thickness` | 0–1 | Limb width. Feeds grip. |
| `leg_spread` | 0–1 | How far legs splay. Wider stance = more agility. |
| `leg_joints` | int 2–3 | Limb sections. A third joint improves grip and gait. |
| `claw_size` | 0–1 | Tarsal claws. Main grip input, small attack contribution. |

### Wings — 3

| Gene | Range | What it does |
|---|---|---|
| `wing_count` | int 0/2/4 | **0 means flightless, full stop** — no wings, no lift, whatever the area. |
| `wing_area` | 0–1 | Wing size. Four small wings beat two large ones of the same total area. |
| `wing_beat` | 0–1 | Beat rate. |

### Weapons and defence — 6

| Gene | Range | What it does |
|---|---|---|
| `mandible_size` | 0–1 | Jaw mass. Raises attack, *lowers* attack rate. |
| `mandible_serration` | 0–1 | Cutting edge. Multiplies the bite. |
| `horn_size` | 0–1 | Rostrum / pronotal horn. Second-largest attack input. |
| `spine_density` | 0–1 | Defensive spikes along the abdomen. Adds to defense. |
| `tail_length` | 0–1 | Cerci / metasoma. Gives the stinger reach. |
| `stinger_size` | 0–1 | Below 0.08 there is no stinger and venom is exactly 0. |

### Sensory — 3

| Gene | Range | What it does |
|---|---|---|
| `eye_count` | int 2–8, even | More eyes widen the field — +11% vision each pair. |
| `eye_size` | 0–1 | Ommatidium size. Primary vision input. |
| `antenna_length` | 0–1 | Picks up what the eyes miss. |

### Physiology and behaviour — 2

| Gene | Range | What it does |
|---|---|---|
| `metabolism` | 0–1 | Burn rate. High = fast recovery, fast exhaustion. |
| `aggression` | 0–1 | **Behavioural only.** Biases the AI state machine; it is not a combat stat. |

### Surface and colour — 9

| Gene | Range | What it does |
|---|---|---|
| `hue` | 0–1, wraps | Base hue. The only circular gene — it wraps rather than clamps. |
| `saturation` | 0–1 | Colour intensity. Costs camouflage. |
| `lightness` | 0–1 | Brightness. Costs camouflage. |
| `pattern` | 0–1 | Selects the marking style: bands / spots / dorsal stripe. |
| `pattern_scale` | 0–1 | Marking density and weight. |
| `pattern_contrast` | 0–1 | Below 0.08 the bug is unmarked. |
| `setae` | 0–1 | Hairiness. Breaks up the outline, helps camouflage. |
| `iridescence` | 0–1 | Metallic sheen. Looks great, **costs camouflage** — a real trade-off. |
| `translucency` | 0–1 | See-through cuticle. Helps camouflage. |

---

## Stats

Two new ones, and several formulas now read the new genes.

| Stat | Driven by |
|---|---|
| **venom** *(new)* | `stinger_size`, `tail_length`. Bypasses armour, lands over time. 0 without a stinger. |
| **grip** *(new)* | `claw_size`, `leg_joints`, `leg_thickness`. Converts effort into motion — gates speed. |
| speed | stride × cadence, now scaled by grip |
| defense | carapace + `spine_density` |
| attack | mandibles + `horn_size` + `claw_size` + body mass |
| health | bulk + shell + `body_segments` |
| flight | 0 unless `wing_count` > 0; then wing loading vs. beat |
| vision | `eye_size` × `eye_count` gain + antennae |
| camouflage | dark/desaturated/small, + `setae` + `translucency`, − `iridescence` |

A seventh fitness preset, **`venomous`**, selects for venom + speed + agility.

---

## The eight archetypes

Generation 0 walks this list round-robin, so a pool of 7 gets 7 different body
plans rather than 7 samples of one distribution. Each genome is drawn around the
archetype's gene biases with per-gene jitter, so two wasps differ but both read
as wasps. **15% of every pool is drawn uniformly at random** as wildcards, to
keep genes in play that no archetype uses.

These are *starting points, not classes.* Nothing in the simulation branches on
archetype; after one crossover the lineages blend freely. The HUD label is
nearest-neighbour over the biased genes and reads **Hybrid** once a genome has
drifted too far from all eight.

| Archetype | Spd | Def | Atk | HP | Fly | Ven | Cam | Character |
|---|---|---|---|---|---|---|---|---|
| **Beetle** | 22 | 92 | 92 | 94 | 10 | 0 | 59 | Armoured bruiser. Thick carapace, horn, short legs — slow, very hard to kill. |
| **Wasp** | 63 | 16 | 30 | 49 | 90 | 88 | 41 | Fast flier with a stinger. Light, aggressive, venomous, almost no armour. |
| **Spider** | 69 | 34 | 92 | 75 | 0 | 47 | 80 | Eight legs, many eyes, no wings. Big vision radius, ambushes with venomous fangs. |
| **Roach** | 74 | 65 | 39 | 71 | 90 | 0 | 62 | Flat, fast, drab. Survives on speed, stamina and camouflage rather than force. |
| **Mantis** | 100 | 21 | 92 | 52 | 90 | 14 | 29 | Long body, hooked forelimbs. Slow to move, devastating in reach — a duelist. |
| **Moth** | 49 | 25 | 23 | 69 | 90 | 0 | 73 | Enormous soft wings, furred body. Great lift and stamina, hopeless in a fight. |
| **Centipede** | 70 | 57 | 68 | 75 | 0 | 84 | 42 | Ten legs on a long segmented body. Quick, spiny, venomous, poorly armoured. |
| **Weevil** | 18 | 69 | 84 | 65 | 46 | 29 | 74 | Small, round, absurdly long snout. Tanky for its size and hard to spot. |

*(Representative draws — jitter means individuals vary around these.)*

Every headline stat spans at least 25 points across the set, and no two
archetypes sit within 20 units of each other in stat space. Both are asserted in
`tests/core.test.js`, so the pool can't quietly collapse back into one animal.

---

## What this looks like in the terrarium

The art layer reads the new genes, so structure is visible rather than just
numeric: segment lines on the abdomen, two- vs. three-jointed legs, tarsal
claws, one or two wing pairs, horns, spine rows, tails with stingers, two to
eight eyes laid out along the head, fur, iridescent sheen, and translucent
cuticle.

A bug hit by a stinger shows **envenomed** in the inspector and keeps losing
health after the attacker has moved on.
