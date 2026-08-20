# Gene and archetype reference

The pool went from **20 genes to 50**, and generation 0 is now seeded from eight
body-plan archetypes instead of uniform random noise.

Every gene below is a scalar on a fixed range, clamped on every write — an
illegal genome cannot exist. `GENE_ORDER` (the key order in
`src/core/genes.js`) is canonical: crossover, serialization and any future
GLB mapping all read it.

---

## The 56 genes

### Body plan — 12

| Gene | Range | What it does |
|---|---|---|
| `body_segments` | int 1–10 (default 2) | Trunk segments, head excluded. Segment 1 is the thorax; the rest are abdominal. 1 = no abdomen. Drives trunk length and health. |
| `body_length` | 0–1 | Stats only — agility. It no longer shapes the bug; `body_segments` does. |
| `body_width` | 0–1 | Overall scale of the trunk — every per-part width/length gene below is a fraction of it. It no longer decides the proportions BETWEEN the masses. |
| `body_mass` | 0–1 | Density, independent of volume. Heavy bugs hit harder and turn worse. |
| `head_width` | 0–1 (default 0.13) | Head's lateral half-axis, 0.12–0.80 of `body_width` (× 1.36 on arachnids). Sets where the eyes and antennae mount. |
| `head_length` | 0–1 (default 0.13) | Head's along-the-body half-axis, same range. Also how far the head stands off the thorax, and where the horn's base and the crown mark sit. |
| `thorax_width` | 0–1 (default 0.287) | Thorax's lateral half-axis, 0.16–0.70 of `body_width` (× 1.334 on arachnids). Legs and wings anchor to it. |
| `thorax_length` | 0–1 (default 0.287) | Thorax's along-the-body half-axis, same range. |
| `abdomen_width` | 0–1 (default 0.41) | Abdominal segments' lateral half-axis, 0.22–1.00 of `body_width`. |
| `abdomen_length` | 0–1 (default 0.41) | Abdominal segments' along-the-body half-axis, same range — a longer chain, not a wider one. |
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

### Wings — 3

| Gene | Range | What it does |
|---|---|---|
| `wing_count` | int 0/2/4 | **0 means flightless, full stop** — no wings, no lift, whatever the area. |
| `wing_type` | int 0–1 | membranous / elytra. Structure only — the blade SHAPE is derived, see below. |
| `wing_area` | 0–1 | Overall wing size — scales length and width together. Four small wings beat two large ones of the same total area. |
| `wing_length` | 0–1 | Blade length along its own axis. |
| `wing_width` | 0–1 | Blade half-width as a fraction of length — aspect ratio, not a second length. |
| `wing_roundness` | 0–1 | Blunt vs. finely tapered tip. Outline only, never the size. |
| `wing_angle` | 0.7–1.0 | Resting sweep off the body axis. The mapping is still 35°–165° at gene 0–1, but only 0.7–1.0 is reachable, i.e. 126°–165°; the 0.85 default renders 145.5°. Walking and attacking subtract 0.3, swinging the blades forward to 87°–126° to beat. |
| `wing_tip_hue` | int 0–10 | Tip wash colour: 0 = white, 1–10 = a reference-palette swatch. |
| `wing_beat` | 0–1 | Beat rate. |

### Weapons and defence — 9

| Gene | Range | What it does |
|---|---|---|
| `mandible_size` | 0–1 | Jaw mass. Raises attack, *lowers* attack rate. |
| `mandible_type` | int 0–2 | wide_thin / narrow_thick / chelicerae. Categorical. The two chelicerae kinds merged; their fang is a serration level now. |
| `mandible_serration` | 0–1 | Cutting edge. Multiplies the bite, and cuts teeth at three levels — `min(2, floor(v × 3))`. Every kind reads it: on the chelicerae, level 1 or 2 adds the single tip fang. |
| `horn_size` | 0–1 | Horn length. Second-largest attack input. |
| `horn_type` | int 0–4 | nose / pincer / y_shaped / split / crown. Categorical. |
| `horn_serration` | int 0–2 (default 0) | Notch level on the horn. Each level is the one below it plus more notches. `crown` is exempt and shows none at any level. |
| `spine_density` | 0–1 | Defensive spikes along the abdomen. Adds to defense. |
| `tail_length` | 0–1 | Cerci / metasoma. Gives the stinger reach. |
| `stinger_size` | 0–1 | Below 0.08 there is no stinger and venom is exactly 0. |

### Sensory — 3

| Gene | Range | What it does |
|---|---|---|
| `eye_count` | int 2–8, even | More eyes widen the field — +11% vision each pair. |
| `eye_type` | int 0–2 | The eye FILL treatment — dark speckled / notched / hooked. There is only one eye shape; this does not change it. Categorical. |
| `eye_size` | 0–1 | Ommatidium size. Primary vision input. |
| `antenna_length` | 0–1 | Picks up what the eyes miss. |

### Physiology and behaviour — 2

| Gene | Range | What it does |
|---|---|---|
| `metabolism` | 0–1 | Burn rate. High = fast recovery, fast exhaustion. |
| `aggression` | 0–1 | **Behavioural only.** Biases the AI state machine; it is not a combat stat. |

### Surface and colour — 11

| Gene | Range | What it does |
|---|---|---|
| `hue` | 0–1, wraps | Base hue. The only circular gene — it wraps rather than clamps. |
| `saturation` | 0–1 | Colour intensity. Costs camouflage. |
| `lightness` | 0–1 | Brightness. Costs camouflage. |
| `pattern_horn` | 0–1 | The HORN's surface treatment: `min(3, floor(v × 4))` → flat / gradient / dots / oval. The 0.08 default is flat — a default bug's horn carries nothing. |
| `pattern_mandible` | 0–1 | The MANDIBLES' treatment. Same four buckets, chosen independently of the horn's. |
| `pattern_leg` | 0–1 | Above 0.5 the limbs go near-black. (These three were one `pattern` gene; it answered three unrelated questions at once.) |
| `light_hue` | int 0–9 | Which reference-palette swatch the body-segment lighting bloom takes its HUE from. 7 = cream, the colour every bug used to get. Heritable and independent of `hue`. Only the hue is used — the swatch's baked-in saturation/lightness are discarded. |
| `lighting_saturation` | 0–1 (default 0.33) | The bloom's own saturation, independent of the body's. |
| `lighting_lightness` | 0–1 (default 0.85) | The bloom's own lightness, independent of the body's — but clamped UP to the body's own lightness, so the light can never render darker than the shell it sits on. |
| `pattern_scale` | 0–1 | Dot size and count for the `dots` treatment: 34 small dots at 0, 9 large ones at 1. Shared by the horn and the jaws. |
| `pattern_contrast` | 0–1 | How loud a treatment reads — gradient depth, dot opacity, oval tone gap. Shared by the horn and the jaws. Firefly, Ladybird and Butterfly all window on it. |
| `setae` | 0–1 | Hairiness. Breaks up the outline, helps camouflage. |
| `iridescence` | 0–1 | Metallic sheen. Looks great, **costs camouflage** — a real trade-off. |
| `translucency` | 0–1 | See-through cuticle. Helps camouflage. |

---

## Stats

Two new ones, and several formulas now read the new genes.

| Stat | Driven by |
|---|---|
| **venom** *(new)* | `stinger_size`, `tail_length`. Bypasses armour, lands over time. 0 without a stinger. |
| **grip** *(new)* | `leg_joints`, `leg_thickness`, plus a constant foot term. Converts effort into motion — gates speed. |
| speed | stride × cadence, now scaled by grip |
| defense | carapace + `spine_density` |
| attack | mandibles + `horn_size` + a constant foot term + body mass |
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
feet, one or two wing pairs, horns, spine rows, tails with stingers, two to
eight eyes laid out along the head, fur, iridescent sheen, and translucent
cuticle.

A bug hit by a stinger shows **envenomed** in the inspector and keeps losing
health after the attacker has moved on.


---

## Kinds, not amounts

`horn_type` and `wing_type` are **categorical**. Horn type 2 isn't "between" 1
and 3, it's a different horn — so they don't take Gaussian jitter like the other
genes. An archetype holds its kind exactly, with a 12% chance per birth of
stepping to an adjacent kind. Enough for a lineage to drift; not enough for a
wasp to sprout a nose horn at random.

**Horns** (5) — `nose` one straight central spike, wide at the base · `pincer`
paired horns curling back in over a tight U of empty space · `y_shaped` a stem
forking into two outward-hooking arms · `split` the big one, heavy base and the
widest sweep · `crown` three prongs, middle longest.

Every horn mounts on the **thorax**, not the head, and is drawn last of
everything so the thorax it grows out of cannot bury its base.

`horn_serration` (0/1/2) adds notches without changing the shape underneath:
barbs up the shaft on `nose`, inner teeth on `pincer`, stem spurs on `y_shaped`,
antler branching on `split`. `crown` is deliberately exempt — the reference
sheet drew no serrated variant of it, so the slider does nothing there.

**Wings** (2 structures, 3 derived silhouettes) — `wing_type` is now only the
structural question: `membranous` soft blades, or `elytra` hard cases closed over
the abdomen with a seam.

The blade SHAPE is not selected — it is **derived** from the wing's own
proportions, the same way `bodyPlan()` derives myriapod from leg count and
segments. One shape coefficient:

    clamp(0.5 + 0.50·wing_length − 0.70·wing_width − 0.30·wing_roundness, 0, 1)

crossed against two thresholds:

| coefficient | silhouette | traced from |
| --- | --- | --- |
| `< 0.34` | `leaf` — broad and rounded, widest past mid-length, blunt tip | top-left panel + the top-right close-up |
| `< 0.62` | `oval` — shorter, narrower, near-symmetric | bottom-left panel |
| `≥ 0.62` | `crescent` — long thin blade bowed back to a fine curved point | bottom-middle panel + the bottom-right close-up |

Longer pushes a wing toward `crescent`; wider and rounder push it toward `leaf`.
The gene defaults evaluate to 0.288, so an untouched bug wears the `leaf`.

The membrane is **always neutral grey at exactly 0.70 alpha**, with no genome
input at all — the reference draws the same grey wing on every bug whatever
colour it is. `wing_tip_hue` is the only colour a genome can put on a wing.

One blade per wing, per side: `wing_count / 2` pairs = that many blades a side.
At four wings the second blade is swept 0.30 rad further back and drawn slightly
shorter, matching the shallow V of the isolated four-wing close-ups.

Wings are drawn **above everything else on the sprite**, the topmost plane.

**Eyes** (3 fills, ONE shape) — the reference sheet draws one eye silhouette
three times and changes only the fill, so `eye_type` no longer selects a shape.
Every eye is the same wedge: a broad rounded corner at the outer-top, tapering to
a point at the inner-lower side, drawn under the head so its edge crops the inner
half. The three fills are `dark` near-black with a scatter of white dots ·
`notched` white with a dark notch cut into the outer-top corner · `hooked` white
with a small dark hook curling in from that corner. There is NO iris on any of
them: the coloured disc that used to sit in the light fills was drawn at the
bright complementary accent hue and read as a pink dot in the middle of the eye.
Nothing coloured is drawn inside an eye.

**Crown mark** (3) — a flat colour patch capping the top ~18% of the head, in
reference-palette gold, clipped to the head so it never overruns the silhouette:
`none` · `solid` a hard crisp lower edge · `blended` faded down into the head
colour. This is the ONLY blend anywhere on the head; the head fill itself is
completely flat, with no gradient, bloom or rim darkening. It has nothing to do
with `horn_type`'s `nose`, which is a spike of horn geometry on the thorax — the
name deliberately avoids the word.

**Mandibles** (3), re-traced from the reference sheet — `wide_thin` long slender
crescents sweeping OUTWARD to a fine point, the pair splaying apart, barbs low on
the inner edge · `narrow_thick` short and heavy, bulk at the base, hooking hard
INWARD so the tips converge, with deep teeth mid-inner-edge · `chelicerae` a
blunt stout column with a domed top, bare at serration 0 and carrying one small
fang at the tip at 1 or 2.

Four kinds became three. `chelicerae_teeth` and `chelicerae_smooth` were the same
column differing by that one fang — a serration level wearing a kind's clothes,
and the only place `mandible_serration` was deliberately ignored. They merged, so
every kind now reads the serration gene the same way.

All three are drawn as filled tapered silhouettes, not strokes — mass at the base
and a point at the tip is what separates a designed horn from a bent line. A horn
or a jaw is accumulated into ONE path and filled, gradiented and decorated once,
so a serrated shape reads as a single patterned object rather than as a pile of
separately-painted pieces.

---

## Body plans

The renderer picks one of three constructions from the genes. This is derived,
not stored, so it can't drift out of sync with the body it describes.

| Plan | When | Shape |
|---|---|---|
| `insect` | fewer than 8 legs | head + thorax + abdomen, legs on the thorax |
| `arachnid` | 8+ legs, compact body | cephalothorax + abdomen, four leg pairs up front |
| `myriapod` | 8+ legs, long body | head + 6–10 repeating segments, **one leg pair per segment** |

A centipede is built as a real centipede — a train of round segments each
carrying its own pair of legs — rather than a beetle stretched lengthwise.
