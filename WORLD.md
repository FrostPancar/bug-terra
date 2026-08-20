# Multiplayer world — `src/world/`

Per-player terrariums placed in a shared grid, connected by a destructible dirt
zone players burrow through. **Nothing here talks to a network.** `DirtWorld`
implements the client half exactly as it will run against a server — predict
locally, apply ops, reconcile — and `LocalAuthority` is a stand-in that runs in
the same process. Swapping in a real transport replaces one object.

| File | What it holds |
|---|---|
| `chunks.js` | chunk storage, dig/fill ops, regrowth, POI rolls |
| `grid.js` | cell topology, spiral assignment, locate/distance |
| `gates.js` | `gateOpen` / `pvpEnabled` and the entry rules |
| `discovery.js` | the falloff curve, dig radius, borrowed-hole detection |
| `index.js` | `DirtWorld`, `LocalAuthority`, the authority table |

## Playing it — `src/sim/burrow.js`

The model above is reached through **burrow mode**, and burrow mode is reached
through a placed **Burrow Entrance** (`src/sim/objects.js`). Where the entrance
sits inside the terrarium decides where the bug comes out underground, so two
entrances really are two ways down.

`Burrow` owns the `DirtWorld` client, a `LocalAuthority` in the same process,
and the view. One dig tick is one `world.burrow()` call — predict, submit,
claim, roll for a neighbour — and the only things that come back out to the HUD
are words: *"turned up a shard of amber"*.

Two constants in that file, both playability rather than model:

- `DIG_SPEEDUP` — `digInterval()` is honest as a simulation rate and unwatchable
  as a control rate.
- `BITE_AHEAD` — how far ahead of itself a bug bites, **as a fraction of its own
  dig radius**, so it must stay below 1. `digRadius` bottoms out at 3 px, and a
  bite centred further out than that opens a pocket that does not touch the hole
  the bug is standing in: a one-pixel shell, with the animal walled in behind it.

Digging is rendered by painting only the *dug* pixels into a canvas texture over
the floor photograph — absence is solid on screen exactly as it is in storage, so
a repaint costs what has been excavated, not what is visible. Chunks dug during a
session are **not** persisted; the terrarium and everything built in it are.

---

## Storage: absence is solid

- The dirt zone is divided into **64×64 chunks**.
- A chunk with no modifications is **implicit solid** — no row, no bytes, no
  traffic. It does not exist.
- The first dig materializes it: a **512-byte bitmask** plus a short sparse list
  for pixels carrying metadata.

```js
const s = new ChunkStore();
for (let i = 0; i < 500; i++) s.isEmpty(i * 37, i * 91);
s.footprint();   // { chunks: 0, bytes: 0 }  — reading solid ground costs nothing
```

### Ops, not chunk dumps

```js
{ chunkId: '4,7', localX: 12, localY: 40, radius: 5, action: 'dig' }
```

Traffic is proportional to *activity near a chunk*, not to chunk size. Two
players digging the same tunnel converge without either side resending anything.

`digOps(x, y, r)` splits a dig that straddles a boundary into one op per chunk,
so every op is addressed to exactly one chunk and is broadcastable to that
chunk's subscribers. Ops are **idempotent** — re-applying one changes nothing,
so replays and reconciliation are safe — and **order-independent**.

### Regrowth

Checked **lazily on chunk load**, not ticked globally. One pass erodes the hole
by a pixel from every solid edge, so a tunnel narrows before it closes and a
wide cavern outlives a scratch. A fully regrown chunk with no metadata and no
claimed POI is **deleted**, returning it to implicit-solid and costing nothing
again.

Pixels beyond a chunk edge do not count as solid, or a tunnel would get pinched
at every 64 px seam — an artefact, not erosion.

> **Open:** a chunk nobody visits could regrow "instantly" from the next
> digger's perspective. Left as-is for now; a background sweep for chunks near
> active players is the fix if it reads badly.

---

## Topology

A **grid of cells**, one per player, cell size matching the terrarium `WORLD`
box. A grid gives one tunable knob — cell spacing — that everything downstream
reads: travel time, discovery rate, storage budget.

New players get the **nearest unclaimed cell to world centre**, spiralling
outward, so the map fills from the middle. That bounds the storage footprint as
the player base grows and stops average inter-player distance drifting upward
forever.

The gap between cells is deliberately wide: a straight-line tunnel to your
neighbour should not be the obvious play.

---

## Gates

Two independent server-authoritative flags, checked **only at the
boundary-crossing moment**.

| Flag | Effect |
|---|---|
| `gateOpen` | whether other players' bugs may enter |
| `pvpEnabled` | whether a visiting bug can fight the owner's |

- Entry is decided **once**. Closing the gate mid-visit does **not** eject
  anyone already inside — trapping a visitor behind you is a better moment than
  a hard ejection, and it costs the server nothing (no forced-relocation path).
- `canFight` requires **both** sides on. One-sided PVP is not PVP.
- `wallMarker(gate)` is what the dirt-zone-facing wall shows before you commit,
  so a closed terrarium reads as a discovery rather than a dead end.
- **Abandoned cells auto-close** after 30 days. It is the simpler default and it
  removes the griefing case where an inactive player's PVP-on terrarium stays
  open with nobody minding it.

---

## Discovery

Two different things get found, tuned against different targets.

### Another player's terrarium

Distance-decayed probability rolled per dig-tick:

```
P(reveal) = base_rate × falloff(distance_from_own_cell)
```

`falloff` is suppressed to 6% inside your own near ring, ramps via smoothstep,
and **plateaus**. The plateau is the whole point — without a ceiling the optimal
play is to tunnel due east as fast as possible.

A successful roll does **not** teleport anyone. It tags a chunk on the
neighbour's wall as discovered and returns a bearing, so reaching it is still a
short deliberate dig. Discovery stays a moment, not a lookup. The check only
runs when a claimed cell is actually within range, so it costs nothing across
the vast middle of the zone.

### Points of interest

Rolled **once per chunk materialization**, seeded off chunk coordinates — so the
same chunk always contains the same thing, on every client, forever, without
storing anything until it is dug.

```js
rollPoi(cx, cy, seed)   // deterministic; a different world seed = a different zone
```

~42% of chunks carry something, weighted common → rare (seed cache, mineral
vein, old burrow, amber shard, fossil egg, deep relic). **First-come-first-serve**:
once claimed it is marked consumed and does not reappear until the chunk decays
and regrows far enough to reroll. Density is a tuning constant, not game logic —
high enough that a normal session finds *something*, while any specific item
stays exhaustible.

### The borrowed hole

Falls out of the shared-chunk model for free — no separate footprint system.
Round a corner and find a tunnel segment already `empty` that you did not dig.
The regrowth timer is what keeps this feeling like a find rather than the norm.

---

## Dig power: no fifteenth stat

The design doc asked whether burrowing needs a new stat. **It does not.** `grip`
already measures how well a bug plants itself and pushes; `attack` already
measures how hard it moves material; `attackRate` sets the cadence.

```js
digRadius({ grip, attack })    // 2 + grip·4 + attack·3, rounded
digInterval({ attackRate })    // 0.9 / rate, clamped to [0.18, 1.2]
```

This keeps the gene vector from growing for one feature, and makes every bug
that already exists immediately meaningful underground.

---

## Authority

Exported as data (`AUTHORITY`) so tests and docs read the same thing the code does.

| State | Owner | Sync |
|---|---|---|
| Genes / stats | server, per-player | on change |
| Terrarium contents | server, per-player | snapshot + events |
| Gate flags | server | push on toggle |
| **Dirt chunks** | **server, shared** | lazy pull + op broadcast |
| POI claims | server, shared | deterministic seed + claim |
| Burrow position | client | predict + reconcile |
| **Terrarium physics** | **client** | **none** |

The dividing line: anything one player can see change because of another
player's action has to be server-authoritative and shared. Everything inside
your own glass stays exactly as client-authoritative as it is today. This layer
adds a shared *world*; it does not change how the terrarium sim runs.

---

## Still open

- **Cross-terrarium PVP resolution** — reuse the existing attack/defense
  exchange, or give visiting combat its own arena rules? Not decided; nothing in
  `src/world/` assumes either.
- **Regrowth cadence** for chunks nobody has loaded in a long time (above).
