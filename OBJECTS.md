# Terrarium objects — `src/sim/objects.js`, `src/sim/plants.js`

Placeable structures, gene and stat modifiers, traversal features, and plants.

## The hard line

**No object ever writes a gene or a stat.**

A Grass Patch does not make a bug grow faster by editing it — it contributes a
growth multiplier that the breeding call reads *at the moment it runs*. A wilted
Berry Bush stops *supplying* berries; it never reaches backward into an animal
that already ate one. The Glass Dome comes closest, and even it only produces an
edit spec that breeding applies to the **child** genome; the edited bug is
untouched.

`tests/plants.test.js` enforces this by inspecting `plants.js`'s imports and
scanning for `computeStats`, `clampGene`, `GENE_ORDER` and `genome`. If the
upkeep loop ever reaches into genetics, the build fails.

---

## Plant lifecycle

```
seed ──► sprout ──► growing ──► mature ──► spreading
  │                                │           │
  │                                └───────────┘  (parent survives)
  └── fails to sprout                    │
                                         ▼
                              declining ──► dead ──► cleared plot
```

A dead plant leaves a **cleared plot**, never a fresh seed. A garden that
reseeds itself forever needs no gardener.

### Three meters, three ways to fail

| Meter | Decays from | Restored by |
|---|---|---|
| **Hydration** | time passing | Pond radius, manual `plot.water()` |
| **Light** | night, Shade Tree, Vine Trellis | daylight, Heat Lamp |
| **Soil** | crowding, digging, trampling | Compost Heap, Filter Stone, lying fallow |

- **one** meter at zero → `declining`, a grace period with a visible wilt
- **two** at zero → decline runs 2.4× faster
- **three** at zero → dead immediately

Rescue a declining plant before the grace runs out and it goes straight back to
what it was doing. Light is the only meter that refills on its own — that is
what daylight *is*.

### Meters live on the plot, not the plant

The design doc left this open. Per-plot won, because it is what makes a dead
plant leave something behind: a cleared plot carries `residue`, which suppresses
soil recovery for a while. Replanting straight into a grave is a worse idea than
moving one square over.

`plant.meters` is a getter that returns the plot, so the update hook reads
exactly as the doc specified:

```js
for (const plant of this.plants) {
  plant.meters.decay(dt, this.env);
  plant.advanceLifecycle(dt, this.env);
  if (plant.state === 'spreading') this.trySpreadSeed(plant);
  if (plant.state === 'dead') this.clearPlot(plant);
}
```

Plants tick **alongside decor, not alongside bugs**. They have no Matter.js body
beyond a collision footprint, and they read the same `behaviourAt()` day/night
signal bug behaviour reads — no second time system.

---

## Catalog

### Breeding structures

| Object | Effect |
|---|---|
| Hive | breeding rate ×1.6 |
| Cave | rate ×0.65, but universal — works for any bug |
| Pond | enables aquatic breeding; waters nearby plants |
| Nest | bonds two chosen bugs; bypasses tournament selection |
| Compost Heap | `selection: 'inverse'` — breeds from the weakest, preserving diversity; feeds the soil |
| Amber Chamber | freezes a genome; cannot breed while stored, revives unchanged |
| Pollen Bloom | rate ×1.45, requires the Winged trait |

The Compost Heap stayed as one object rather than splitting in two. The dual
purpose *is* the idea: you park your worst bugs next to the thing that feeds
your garden.

### Gene modifiers

| Object | Effect |
|---|---|
| Glass Dome | hand-edit a gene; `expressIn: 'offspring'` — never the edited bug |
| Crucible | `mutationScale ×3.2` — high-variance gambling breeding |
| Prism Chamber | pins a chosen gene against mutation |

### Stat modifiers (non-genetic)

| Object | Trains | Notes |
|---|---|---|
| Training Rock | attack, defense | genes untouched |
| Feeding Trough | stamina, recovery | temporary, decays over 5 min |
| Obstacle Course | agility, speed | must be physically traversed |
| Root Tangle | defense, grip | slows you at ×0.55 while you learn |

### Traversal

Wormway (paired fast travel) · Bridge/Tunnel (permanent link, no jump) ·
Beacon (idle-wander attractor — steering, not commanding) · Vine Trellis
(climbable, and shades what is under it).

**Burrow Entrance** is the one object that leads *out* of the terrarium. It
carries `traversal.entrance`, and it is the only way into burrow mode: the HUD
will not go underground until one has been placed, and tapping the hole itself
sends the selected bug down it. See `src/sim/burrow.js` and `src/ui/modes.js`.

### Environmental

Heat Lamp (`light +0.55`) · Shade Tree (`light −0.45`) · Filter Stone (aquatic
bonus, feeds soil) · Mushroom Ring (`fitnessBonus +0.12` for bugs that linger).

### Plants

| Plant | Growth | Lifespan | Yields |
|---|---|---|---|
| Grass Patch | ×1.0 | ×1.0 | breed-time growth ×1.25 |
| Moss Bed | ×0.6 | ×1.9 | growth ×0.78, lifespan ×1.3 |
| Flowering Bush | ×0.9 | ×1.0 | nectar every 70 s |
| Fern Cluster | ×0.85 | ×1.2 | juvenile growth ×1.45 |
| Berry Bush | ×0.8 | ×1.1 | berry every 90 s |
| Seed Pod | ×1.0 | ×0.8 | 85% spread chance |

---

## Placement

**Free placement with a minimum-spacing check**, matching how the rock decor
already avoids overlap. Grid placement was the alternative; free placement keeps
the terrarium reading as a terrarium rather than a board.

```js
canPlace(objects, 'pond', x, y)        // footprint + footprint + gap
fieldAt(objects, x, y)                 // aggregate influence at a point
breedingModifiers(objects, x, y)       // multipliers, read at breed time
```

`fieldAt` has no concept of state on purpose — a dead or dormant object should
simply not be in the list you pass it.

## Where the wiring lands

`TerrariumScene.buildGarden()` creates the `PlantBed` and a starter garden.
`update()` ticks it beside the day/night read, and `trainingTick()` runs there
too — a bug inside a trainer's radius for a full session advances the training
channel and takes the non-genetic gain.

`breed()` calls `breedingModifiers` at the breeding site and passes **every**
field it returns into `breedGeneration`: `rate` as generational turnover,
`selection`, `mutationScale`, `fitnessBonus` scoped to the bugs actually
standing in the ring, `growthRate` as the size of the brood, the Nest's bonded
pair, and the eligibility set a `requires` gate implies. All of them change how
the next draw is taken; none of them writes a gene.

Lineage locks now apply on their own rather than waiting on a Prism Chamber —
holding its identity genes steady is what a taxon *is*. The Prism Chamber's
contribution is to pin the loosened genes too.
