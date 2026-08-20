# Hidden stats — `src/core/impressions.js`, `src/sim/knowledge.js`

> "There's no menu that says *Attack: 74*. Genes and stats stay hidden — you
> find out what a bug is capable of by putting it in situations and watching
> what happens."

The stats still exist and are still a pure function of genes. They are simply
not the interface. This is the layer between the numbers the simulation needs
and the language the player gets.

## What changed

| Before | Now |
|---|---|
| 14 labelled stat bars | phrases you have earned |
| 48 gene chips with values | physical facts visible on the sprite |
| `HP 62 / 78`, `Energy 31 / 55` | `hurt`, `flagging` |
| `best fit 41.2 · mean fit 33.8` | `the pool is coming along` |
| gene diversity as a number | `wildly different animals` |
| nearest-archetype guess | the real classification, or a hybrid name |

`tests/hidden.test.js` enforces it structurally: `src/main.js` and everything
under `src/ui/` may not reference `GENE_ORDER`, `GENE_SPECS`, `STAT_KEYS`,
`computeStats` or `classify(`. `Bug.snapshot()` may not contain `genome:`,
`stats:` or `hp:`. `emitState()` may not contain `bestFitness` or `meanFitness`.
No impression phrase may contain a digit.

The numbers are still reachable — `Bug.debugSnapshot()` exists for tools and
tests. The UI just cannot get to them.

---

## Two rules for the vocabulary

**1. No numbers out.** Every export returns words.

**2. Nothing mid-range is worth saying.** An average bug produces very few
impressions, because "it's fine at everything" is not something you'd notice
about an animal. Each stat has five bands and the middle one is `null`.

```js
speed: [
  [0.00, 'barely moves — you keep checking whether it is alive'],
  [0.22, 'plods'],
  [0.42, null],                                    // unremarkable, say nothing
  [0.70, 'covers ground quickly'],
  [0.86, 'freakishly fast, for no reason you can point at'],
]
```

A bug with every gene at its midpoint yields at most a handful of lines. A
maxed-out brick shouts about exactly one thing.

Absences are described by the body, not by a zero. A flightless bug produces no
flight impression at all — `physicalReadout` says **no wings** instead.

---

## Earning it

`impressions.js` holds the vocabulary. `knowledge.js` holds the earning of it.
Nothing there touches genes or stats — it only records that the player was
present for something.

| Channel | Unit | Reveals |
|---|---|---|
| `watch` | seconds on screen | speed, agility, stamina, recovery, flight, vision, camouflage |
| `combat` | fights | attack, defense, health, attack rate, venom |
| `training` | sessions | grip |
| `vet` | visits | nothing about performance — physical facts only |

Cost scales down with salience: "freakishly fast" is obvious in seconds,
"slow to recover" takes a while to become a thing you'd say out loud.

You cannot learn how hard something hits by staring at it. Ten minutes of
watching a beetle reveals nothing on the combat channel; ten fights do.

Unearned phrases are **absent** — not greyed out, not teased. Familiarity is a
phrase too: *a stranger* → *starting to get a sense of it* → *you know its
habits* → *few surprises left* → *you know this one*.

Records are keyed by `genomeId`, a pure hash of the gene vector, and export to
plain JSON for storage — and that storage now exists. `src/sim/save.js` writes
the whole run to `localStorage` on a debounce, so the impressions you earned are
still there after a reload. Before that they were not, which made the earning
loop a strange thing to ask of anyone.

`training` also has a caller now: standing inside a Training Rock, Obstacle
Course, Feeding Trough or Root Tangle for a full session advances the channel.
It is the only way to earn `grip`, so before it was wired that phrase could not
be reached at all.

---

## The Vet Station

The one sanctioned path from a genome to the player, and deliberately the least
useful view for min-maxing. It tells you what the bug **is**, never what it is
**worth**.

`TerrariumScene.vetPortrait(bug)` returns a **canvas** and a list of
**sentences**. The genome crosses into the UI as pixels and prose, with no way
back to a number: the portrait is drawn at ~30 px/unit, held still, head-up, so
every part reads clearly.

It costs time, on purpose:

```
available ──(send)──► visiting (90 s) ──► cooldown (240 s) ──► available
```

While visiting, the bug is **out of the terrarium** — removed from `scene.bugs`,
sprite hidden, physics static. It comes home when the visit elapses and cannot
go straight back in. Checking every bug constantly is not a strategy.

---

## What this does to breeding

Selection still runs on a numeric fitness — it has to — but the number never
leaves `emitState()`. The preset selector is relabelled **breeding for**, and
the pool is described rather than scored.

Because you are judging bugs by feel, breeding decisions become about which bugs
*seem* right to keep pairing, not about chasing a maxed stat line. Two players
will walk away with a different read on the best bug in their terrarium, because
they each learned it through their own experience with it.
