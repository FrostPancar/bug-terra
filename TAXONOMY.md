# Taxonomy — `src/core/classification.js`

Classification is a **second pure read off genes**. Stats are one read; this is
the other. Same discipline: no time, no randomness, no world state, no history.
`classify(genome)` called a thousand times on the same genome returns a
deep-equal result every time, and `tests/classification.test.js` asserts it.

```
genes ──┬──► computeStats()  ──► physics, animation, fitness
        └──► classify()      ──► identity, specialties, breeding locks
```

The arrow never reverses. A bug's taxon is not stored, not assigned at birth,
and not inherited — it is recomputed from the gene vector whenever anyone asks.

---

## Gene count: this build has 48, the design doc had 37

The taxonomy doc was written against a 37-gene vector. The live build has **43**.
The extra genes are the categorical "kind" genes added during the art
revamp:

| Gene | Range | Kinds |
|---|---|---|
| `wing_type` | int 0–1 | membranous, elytra (blade shape is derived, not selected — see GENES.md) |
| `mandible_type` | int 0–3 | wide_thin, narrow_thick, chelicerae_teeth, chelicerae_smooth |
| `horn_type` | int 0–4 | nose, pincer, y_shaped, split, crown |
| `eye_type` | int 0–2 | the eye FILL treatment: dark speckled, notched, hooked (one shape, three fills) |
| `crown_mark_style` | int 0–2 | head-top colour patch: none, solid, blended. Unrelated to `horn_type`'s `nose` |

Windows here are authored against the **live `GENE_ORDER`**, and the kind genes
are used where they carry real taxonomic weight: Rhinoceros Beetle requires
`horn_type = 0` (nose), Stag Beetle requires `horn_type = 1` (pincer), Weevil
and True Bug both require `horn_type = 2`. Index 2 used to be the `rostrum`
snout; the horn redesign put `y_shaped` there and left no snout in the set, so
the beaked taxa kept their index and inherited the fork. The windows are
unchanged — only the shape behind the index is. `tests/classification.test.js` fails if
any window names a gene that does not exist or escapes its declared range.

---

## Two systems, one seam

### 1. Clade brackets — `cladeOf(genome)`

Mechanical partitions on keystone genes. **Total**: every genome lands in
exactly one bracket per axis, with no authoring and no gaps.

| Axis | Gene(s) | Brackets |
|---|---|---|
| `legPlan` | `leg_count` | hexapod (4–6) · arachnid (8) · myriapod (10) |
| `wingPlan` | `wing_count` | apterous (0) · dipterous (2) · tetrapterous (4) |
| `massClass` | `body_mass` | micro (≤0.18) · standard · titan (≥0.80) |
| `venomClass` | `stinger_size` + `tail_length` | none · mild · potent · lethal |
| `surfaceClass` | `translucency` / `iridescence` / `setae` | ghost · radiant · furred · ironclad |

### 2. The chassis tree — `CLASS_TREE`

Hand-authored gene windows in a parent/child tree. A genome matches the deepest
node whose window it satisfies. **Most genomes match nothing below Larva, and
that is correct** — a taxon is supposed to be an achievement.

### The seam: hybrids

**No chassis window constrains `leg_count`.** Breed a Beetle from six legs to
eight and it does not become a Spider — it keeps Beetle's armour windows while
its clade bracket flips to arachnid, and the result reads as an **Armoured
Arachnid**. Hybrids fall out of the two systems disagreeing; there is no
special case for them anywhere in the code.

```js
classify({ ...beetle, leg_count: 8 })
// { id: 'armored_beetle', hybrid: true, name: 'Ironclad Arachnid',
//   clade: { legPlan: 'arachnid', ... } }
```

---

## Descent rule

At each level, among the children whose windows match, pick:

1. the one leading to the **deepest reachable identity**, then
2. the **tightest window** (most constraints), then
3. the one the genome sits **furthest inside**.

Depth-first rather than greedy-first matters. A max-armour nose-horned beetle
matches both Rhinoceros Beetle (a leaf) and Armoured Beetle (which has
Siege-Tank Rhinoceros under it). Greedy specificity picks the leaf and the
tier-3 node becomes permanently unreachable; preferring depth lets a lineage
finish the climb it qualified for.

---

## The hard wall: Beetle ⇄ Moth

Beetle's window now carries an explicit `wing_area: [0, 0.35]` ceiling. Moth
requires `wing_area ≥ 0.85`. The two constrain the same gene in opposite
directions, so a lineage crossing between them must pass through a stretch of
gene-space satisfying **neither** window — a temporary Larva/Hybrid state —
before it can re-emerge on the other line.

Three tests hold this: the ceiling sits below the floor, no genome satisfies
both windows at once, and walking `wing_area` from one to the other passes
through a real gap.

---

## The tree

Tier 0 · **Larva** — everything starts here and most things stay here.

### Tier 1 — orders (all natively hexapod)

| Taxon | Order | Window |
|---|---|---|
| Beetle | Coleoptera | `carapace ≥.55`, `horn ≥.50`, `leg_length ≤.45`, **`wing_area ≤.35`** |
| Wasp | Hymenoptera | `wing_count = 4`, `stinger ≥.60`, `carapace ≤.30` |
| Roach | Blattodea | `antenna ≥.75`, `pattern ≥.7`, `aggression ≤.4` |
| Mantis | Mantodea | `claw ≥.80`, `body_length ≥.75`, `leg_length ≥.60` |
| Moth | Lepidoptera | `wing_area ≥.85`, `setae ≥.75`, `mandible ≤.20` |
| Dragonfly | Odonata | `wing_area ≥.7`, `eye_count ≥6`, `eye_size ≥.6`, `aggression ≥.5` |
| Fly | Diptera | `wing_count = 2`, `wing_beat ≥.72`, `body_mass ≤.30`, `mandible ≤.25` |
| True Bug | Hemiptera | `horn_type = y_shaped`, `horn .35–.78`, `mandible ≤.30`, `carapace .25–.65` |
| Grasshopper | Orthoptera | `leg_length ≥.70`, `leg_thickness ≥.55`, `antenna ≥.45`, `body_length ≥.45` |
| Firefly | Coleoptera | `wing_count 2–4`, `wing_type = elytra`, `carapace ≤.35`, `pattern_contrast ≥.7` |
| Butterfly | Lepidoptera | `wing_area ≥.85`, `mandible ≤.20`, `setae ≤.30`, `pattern_contrast ≥.75`, `saturation ≥.65` |

The last two are here rather than under Beetle and Moth because each one is the
**negation of its parent's defining gene** — see *Structural questions* below.
Their `order` still says Coleoptera and Lepidoptera, because that is where the
real relationship lives. Order and parent are allowed to disagree; that is the
same seam hybrids fall out of.

### Tier 1 — the two non-hexapod brackets

Per §5 of the design doc, **Arachnid and Myriapod are pure `leg_count` brackets,
not hand-authored windows.** Their windows are empty; membership is decided by
the clade axis alone, so any chassis can drift into them symmetrically.

### Tier 2

| Taxon | Parent | Specialty |
|---|---|---|
| Armoured Beetle | Beetle | Armour Plating — defense ×1.15 |
| Thorax Goliath | Beetle | Overwhelming Mass — attack ×1.10, health ×1.08 |
| Rhinoceros Beetle | Beetle | Leverage — attack ×1.12 |
| Stag Beetle | Beetle | Locking Jaws — attack ×1.14, rate ×0.92 |
| Jewel Beetle | Beetle | Dazzle — agility ×1.08, camouflage ×0.88 |
| Ground Beetle | Beetle | Run Down — speed ×1.10 |
| Ladybird | Beetle | Warning Colours — defense ×1.10 |
| **Weevil** | **Beetle** | Boring Snout — attack ×1.06, defense ×1.06 |
| Venom Striker | Wasp | Concentrated Venom — venom ×1.20 |
| Swift Flier | Wasp | Aerial Mastery — speed ×1.10, flight ×1.15 |
| **Hornet** | **Wasp** | Harrying — attack rate ×1.12 |
| Spider | Arachnid | — |
| Scorpion | Arachnid | Pincer and Tail — venom ×1.12, defense ×1.08 |
| Centipede | Myriapod | — |
| Millipede | Myriapod | Curl — defense ×1.14, speed ×0.92 |

### Tier 3

| Taxon | Parent | Specialty |
|---|---|---|
| Siege-Tank Rhinoceros | Armoured Beetle | Siege Plating — defense ×1.25, **replaces parent** |
| Apex Venom Wyrm | Venom Striker | Apex Toxin — venom ×1.35 |

A `replacesParent` specialty drops everything above it. Siege Plating is not
Armour Plating plus 25%; it is what Armour Plating became.

---

## Traits

Flat, stackable, orthogonal to the chassis. A Ladybird can also be Venomous and
Camouflaged without anything about the tree changing.

| Trait | Window | Applies to |
|---|---|---|
| Venomous | `stinger ≥.60`, `tail ≥.40` | any |
| Winged | `wing_count ∈ [2,4]`, `wing_area ≥.45` | only normally-grounded chassis |
| Camouflaged | `saturation ≤.25`, `translucency ≥.55` | any |

Winged is scoped on purpose: a winged wasp is not a remarkable fact about a wasp.

---

## Structural questions, resolved

| Question | Decision |
|---|---|
| Weevil was a stray Tier-1 root | **Moved under Coleoptera** as Tier 2. Curculionidae is a beetle family, and the weevil archetype satisfies Beetle's window cleanly. |
| Hornet sat beside Wasp | **Nested under Wasp** as Tier 2 — it reads as an aggressive wasp, not a sibling order. |
| Arachnid/Myriapod windowed too narrowly | **Redefined as pure `leg_count` brackets.** Spider and Centipede moved down to Tier 2 beneath them. |
| Pill Bug is a crustacean | **Left out.** It does not share a root with Larva, and inventing a second root for one unwindowed taxon is not worth it yet. |
| Ground Beetle asked for `leg_length ≥.60` under a Beetle capped at `.45` | **Narrowed the child to `[0.34, 0.45]`.** Carabidae is a beetle family — the Weevil call above applies unchanged — and the blurb already said "quick *for a beetle*". Long-for-a-beetle is the top of Beetle's range, not a mantis's legs. |
| Firefly asked for `carapace ≤.35` under a Beetle floored at `.55` | **Re-parented to Larva**, keeping `order: Coleoptera`. Its whole idea is "gave up its shell" and Beetle's single defining gene is its shell; narrowing it deletes the concept, loosening Beetle deletes Beetle. |
| Butterfly asked for `setae ≤.30` under a Moth floored at `.75` | **Re-parented to Larva**, keeping `order: Lepidoptera`. "Same chassis, opposite surface" is now *stated* — `wing_area` and `mandible_size` are copied onto the node — rather than inherited from a parent that also demands fur. |

All three were **unreachable**: `classify()` only reaches a node when every
ancestor's window is satisfied too, so a child that contradicts its parent can
never be anyone. `mergedWindow()` in `src/core/taxonBuild.js` finds them and
`tests/parts.test.js` asserts every taxon builds a genome that classifies as
itself, so this class of bug cannot come back quietly.

Re-parenting the last two keeps the §4 hard wall intact: Butterfly still requires
`wing_area ≥ 0.85`, so a Beetle lineage reaching it still has to cross the same
gap it always did.

One deviation from the doc's drafted numbers is recorded in the source: Weevil's
window was widened from `[0.80, 0.45, 0.55]` to `[0.72, 0.42, 0.52]`. The
drafted thresholds predate the weevil archetype's spread and roughly a third of
draws fell outside their own taxon. A starting archetype should read as the
thing it was drawn for.

---

## API

```js
import { classify, cladeOf, applySpecialties, breedingMask, nearestNodes }
  from './src/core/classification.js';

const c = classify(genome);
// { id, taxon, tier, order, path, clade, hybrid, name, blurb,
//   traits, specialties, locks, unlocks, status }

applySpecialties(computeStats(genome), c);   // specialty-modified stats
breedingMask(c);                             // { locked: [...], unlocked: [...] }
nearestNodes(genome, { limit: 3 });          // what it's drifting toward
```

`locks` are genes a lineage holds steady through breeding; `unlocks` widen a
gene's mutation range. Both are consumed by `breedGeneration` — this module
never touches a genome itself.
