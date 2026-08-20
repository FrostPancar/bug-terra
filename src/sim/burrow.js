// Burrow mode — the dirt zone, played.
//
// `src/world/` already holds the whole model: chunk storage where absence is
// solid, dig ops, lazy regrowth, deterministic POIs, and a client that predicts
// locally and reconciles against an authority. None of it had a way in. This is
// that way in: one bug, one hole, and the dirt around it.
//
// What this module is responsible for:
//   * owning the DirtWorld client and its stand-in authority
//   * turning a pointer into dig ticks at the cadence the bug's own body allows
//   * painting the visible slice of the dirt zone, and only when it changes
//   * reporting finds as events, so the HUD can say them in words
//
// What it deliberately is NOT: a second physics world. The digger is moved by
// hand against the chunk bitmask, because Matter.js has no opinion worth having
// about a hole with a bug in it.

import { DirtWorld, LocalAuthority } from '../world/index.js';
import { CHUNK, worldToChunk } from '../world/chunks.js';
import { digRadius } from '../world/discovery.js';
import { WORLD } from './terrarium.js';

/** Dirt px -> world px. Sets how enclosed the tunnel feels; see `enter()`. */
const SCALE = 4;

/** Painted margin beyond the screen, in dirt px. One chunk each way. */
const PAD = 64;

/**
 * Dig cadence multiplier. `digInterval()` is tuned as a simulation rate, and a
 * bug chewing forward at its honest cadence is unwatchable — this is the one
 * playability constant in the module, and it is deliberately in one place.
 */
const DIG_SPEEDUP = 5;

/**
 * How far ahead of itself a bug bites, as a fraction of its own dig radius.
 *
 * It has to be BELOW 1. `digRadius` is as small as 3 px for a bug with no grip,
 * and a bite centred further out than its own radius opens a pocket that does
 * not touch the hole the bug is standing in — a shell of solid dirt one pixel
 * thick, with the animal walled in behind it. Keeping the bite overlapping is
 * what guarantees a tunnel is a tunnel rather than a row of beads.
 */
const BITE_AHEAD = 0.85;

/** Flat colours, same cut-paper palette as everything above ground. */
const LOAM = [201, 154, 99];        // a fresh tunnel, lighter than packed dirt
const DARK = 0x241708;              // the wash that makes underground underground

const POI_COLOUR = {
  seed_cache: 0x6f7f43,
  mineral_vein: 0x2f52c4,
  old_burrow: 0x6d4f30,
  amber_shard: 0xf2be3c,
  fossil_egg: 0xefe2c9,
  deep_relic: 0x7c4bb8,
};

/** What a find is called out loud. The dirt zone names things, it never scores them. */
const POI_SAID = {
  seed_cache: 'a seed cache',
  mineral_vein: 'a mineral vein',
  old_burrow: "someone's old burrow",
  amber_shard: 'a shard of amber',
  fossil_egg: 'a fossil egg',
  deep_relic: 'a relic, very deep',
};

export class Burrow {
  /** @param {Phaser.Scene} scene */
  constructor(scene, { playerId = 'you', seed = 20260819 } = {}) {
    this.scene = scene;
    this.playerId = playerId;
    // One process, both halves. Swapping this for a transport is the only
    // change multiplayer needs here — see src/world/index.js.
    this.authority = new LocalAuthority({ seed });
    this.world = new DirtWorld(playerId, this.authority, { seed });

    this.active = false;
    this.bug = null;
    this.digger = null;             // a plain image; no body, no Matter
    this.pos = { x: 0, y: 0 };
    this.facing = Math.PI / 2;
    this.target = null;
    this.digClock = 0;
    this.clock = 0;
    this.finds = [];
    this.origin = { x: 0, y: 0 };
    this.painted = false;
  }

  /* ------------------------------------------------------------- lifecycle */

  /**
   * Go under. `entrance` is the placed Burrow Entrance the bug is going through:
   * where it sits inside the terrarium decides where you come out underground,
   * so two entrances on opposite walls really are two different ways down.
   */
  enter(bug, entrance) {
    if (!bug) return false;
    this.bug = bug;
    this.active = true;
    this.finds = [];
    this.target = null;
    this.digClock = 0;

    // Terrarium-relative -> cell-relative, then a step below the floor. The
    // home cell is the box this player's terrarium occupies in the shared grid.
    const b = this.scene.terrariumBounds;
    const home = this.world.homeRect;
    const fx = b.width ? (entrance.x - b.x) / b.width : 0.5;
    this.pos = {
      x: Math.round(home.x + home.w * Math.min(0.92, Math.max(0.08, fx))),
      y: Math.round(home.bottom + 26),
    };
    this.facing = Math.PI / 2;

    this.world.loadAround(this.pos.x, this.pos.y, this.clock, 4);
    // A starting chamber, so the bug is standing in a hole rather than inside
    // solid ground it has not earned yet. Stepped by less than one bite so the
    // shaft is continuous even for a bug that digs a three-pixel hole.
    const step = Math.max(1, Math.round(digRadius(this.bug.stats) * BITE_AHEAD));
    for (let i = 4; i >= 0; i--) {
      this.world.burrow(this.pos.x, this.pos.y - i * step, this.bug.stats, this.clock);
    }

    this.buildView();
    this.recenter();
    return true;
  }

  /** Come back up. Everything dug stays dug — the dirt zone outlives the trip. */
  exit() {
    this.active = false;
    this.target = null;
    this.digger?.destroy();
    this.digger = null;
    this.tunnels?.setVisible(false);
    this.wash?.clear();
    this.markers?.clear();
    return this.finds;
  }

  /* ----------------------------------------------------------------- view */

  buildView() {
    const s = this.scene;
    this.vw = Math.ceil(WORLD.w / SCALE) + PAD * 2;
    this.vh = Math.ceil(WORLD.h / SCALE) + PAD * 2;

    // The wash sits UNDER the tunnels: packed dirt is the floor photograph gone
    // dark, and a tunnel is the one thing down here with light in it.
    if (!this.wash) this.wash = s.add.graphics().setDepth(2);
    // Above the light layer (40): a find you uncovered and the animal doing the
    // uncovering are the two things the dark is not allowed to swallow.
    if (!this.markers) this.markers = s.add.graphics().setDepth(41);

    const key = 'burrow-tunnels';
    if (s.textures.exists(key)) s.textures.remove(key);
    this.tex = s.textures.createCanvas(key, this.vw, this.vh);
    this.tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.img = this.tex.getSourceImage();
    this.ctx = this.tex.getContext();
    this.buffer = this.ctx.createImageData(this.vw, this.vh);

    this.tunnels?.destroy();
    this.tunnels = s.add.image(0, 0, key).setOrigin(0, 0).setDepth(3);
    this.tunnels.setScale(SCALE);
    this.tunnels.setVisible(true);

    this.digger = s.add.image(0, 0, this.bug.texKey, '0').setDepth(42).setScale(1.05);
  }

  /** Re-anchor the painted window on the digger and repaint it whole. */
  recenter() {
    this.origin = {
      x: Math.round(this.pos.x - this.vw / 2),
      y: Math.round(this.pos.y - this.vh / 2),
    };
    this.world.loadAround(this.pos.x, this.pos.y, this.clock, 5);
    this.buffer.data.fill(0);
    // Absence is solid, so an unmaterialized chunk is simply not painted — the
    // cost of a repaint is proportional to what has been DUG, not to the window.
    const c0 = worldToChunk(this.origin.x, this.origin.y);
    const c1 = worldToChunk(this.origin.x + this.vw, this.origin.y + this.vh);
    for (let cy = c0.cy; cy <= c1.cy; cy++) {
      for (let cx = c0.cx; cx <= c1.cx; cx++) this.blitChunk(cx, cy);
    }
    this.flush();
    this.painted = true;
  }

  /** Paint one chunk's dug pixels into the buffer. Absent chunk: nothing to do. */
  blitChunk(cx, cy) {
    const chunk = this.world.cache.peek(cx, cy);
    if (!chunk || chunk.dug === 0) return;
    const ox = cx * CHUNK - this.origin.x;
    const oy = cy * CHUNK - this.origin.y;
    const data = this.buffer.data;
    for (let ly = 0; ly < CHUNK; ly++) {
      const py = oy + ly;
      if (py < 0 || py >= this.vh) continue;
      for (let lx = 0; lx < CHUNK; lx++) {
        const px = ox + lx;
        if (px < 0 || px >= this.vw) continue;
        const i = ly * CHUNK + lx;
        if (((chunk.bits[i >> 3] >> (i & 7)) & 1) !== 1) continue;
        const o = (py * this.vw + px) * 4;
        data[o] = LOAM[0]; data[o + 1] = LOAM[1]; data[o + 2] = LOAM[2]; data[o + 3] = 244;
      }
    }
  }

  flush() {
    this.ctx.putImageData(this.buffer, 0, 0);
    this.tex.refresh();
  }

  /** Whether the painted window still covers the screen around the digger. */
  needsRepaint() {
    const halfW = WORLD.w / (2 * SCALE);
    const halfH = WORLD.h / (2 * SCALE);
    return this.pos.x - halfW < this.origin.x + 8
      || this.pos.x + halfW > this.origin.x + this.vw - 8
      || this.pos.y - halfH < this.origin.y + 8
      || this.pos.y + halfH > this.origin.y + this.vh - 8;
  }

  /* ---------------------------------------------------------------- input */

  /** Point the digger at a world-space pointer. Held or tapped, both work. */
  aim(pointer) {
    if (!this.active) return;
    this.target = {
      x: this.pos.x + (pointer.worldX - WORLD.w / 2) / SCALE,
      y: this.pos.y + (pointer.worldY - WORLD.h / 2) / SCALE,
    };
  }

  /* ----------------------------------------------------------------- loop */

  update(dt) {
    if (!this.active || !this.bug) return;
    this.clock += dt;
    this.digClock -= dt;

    const p = this.scene.input.activePointer;
    if (p?.isDown) this.aim(p);

    let dug = null;
    if (this.target) {
      const dx = this.target.x - this.pos.x;
      const dy = this.target.y - this.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) this.target = null;
      else {
        this.facing = Math.atan2(dy, dx);
        const ux = dx / dist;
        const uy = dy / dist;

        // Move only through dirt that is already gone. Everything else waits on
        // the next dig tick, which is what makes a slow bug feel slow down here
        // without a single new stat.
        let step = Math.min(dist, this.speed * dt);
        while (step > 0) {
          const s = Math.min(1, step);
          const nx = this.pos.x + ux * s;
          const ny = this.pos.y + uy * s;
          if (this.world.isSolid(Math.round(nx), Math.round(ny))) break;
          this.pos.x = nx;
          this.pos.y = ny;
          step -= s;
        }

        if (this.digClock <= 0) {
          // Bite ahead of itself, but still overlapping itself — see BITE_AHEAD.
          const reach = this.bite * BITE_AHEAD;
          dug = this.dig(this.pos.x + ux * reach, this.pos.y + uy * reach);
          this.digClock = this.world.digCooldown(this.bug.stats) / DIG_SPEEDUP;
        }
      }
    }

    if (this.needsRepaint()) this.recenter();
    else if (dug) this.flush();

    this.draw();
  }

  /** Movement rate in dirt px/sec, straight off the legs it already has. */
  get speed() {
    return 14 + (this.bug?.stats.speed ?? 40) * 0.36;
  }

  /**
   * How wide a bite this bug takes, in dirt px. The same pure function the
   * world uses when it applies the op — read here only so the bug knows where
   * to aim, never to decide how much dirt actually moves.
   */
  get bite() {
    return digRadius(this.bug?.stats ?? {});
  }

  /**
   * One dig tick. `DirtWorld.burrow` does the whole round trip — predict, submit,
   * claim whatever POI is in the chunk, roll for a neighbour's terrarium — and
   * hands back what happened. All this has to do is repaint and say it.
   */
  dig(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const res = this.world.burrow(ix, iy, this.bug.stats, this.clock);
    if (!res.predicted && !res.found && !res.reveal) return false;

    // Only the chunks the bite actually touched need repainting.
    const c0 = worldToChunk(ix - res.radius, iy - res.radius);
    const c1 = worldToChunk(ix + res.radius, iy + res.radius);
    for (let cy = c0.cy; cy <= c1.cy; cy++) {
      for (let cx = c0.cx; cx <= c1.cx; cx++) this.blitChunk(cx, cy);
    }

    if (res.found) {
      const said = POI_SAID[res.found.kind] ?? res.found.kind.replace(/_/g, ' ');
      this.finds.push({ kind: res.found.kind, rarity: res.found.rarity, said });
      this.say(`${this.bug.name} turned up ${said}.`, res.found.rarity);
    }
    if (res.reveal) {
      // Not a teleport and not a map pin: a direction, and a wall to go find.
      this.say('Something hollow off that way — another terrarium.', 'rare');
    }
    return true;
  }

  say(text, tone = 'common') {
    this.scene.events.emit('burrowNote', { text, tone });
  }

  /* ----------------------------------------------------------------- paint */

  draw() {
    const sx = (x) => (x - this.pos.x) * SCALE + WORLD.w / 2;
    const sy = (y) => (y - this.pos.y) * SCALE + WORLD.h / 2;

    this.wash.clear();
    this.wash.fillStyle(DARK, 0.72).fillRect(0, 0, WORLD.w, WORLD.h);

    this.tunnels.setPosition(sx(this.origin.x), sy(this.origin.y));

    // Claimed POIs, where they were found. A flat chip of colour, nothing more.
    this.markers.clear();
    const c0 = worldToChunk(this.origin.x, this.origin.y);
    const c1 = worldToChunk(this.origin.x + this.vw, this.origin.y + this.vh);
    for (let cy = c0.cy; cy <= c1.cy; cy++) {
      for (let cx = c0.cx; cx <= c1.cx; cx++) {
        const chunk = this.world.cache.peek(cx, cy);
        if (!chunk?.poi?.claimed) continue;
        const x = sx(cx * CHUNK + chunk.poi.lx);
        const y = sy(cy * CHUNK + chunk.poi.ly);
        this.markers.fillStyle(POI_COLOUR[chunk.poi.kind] ?? 0xefe2c9, 1);
        this.markers.fillRoundedRect(x - 7, y - 7, 14, 14, 4);
      }
    }

    this.digger.setPosition(WORLD.w / 2, WORLD.h / 2);
    this.digger.setRotation(this.facing + Math.PI / 2);

    // The one light down here, and it is coming off the bug. TWO flat pools,
    // not a stack of rings: stepping the falloff finely enough to look smooth
    // is a gradient drawn badly, and this scene has no gradients in it. Cut
    // paper means you can count the layers.
    const g = this.scene.lightLayer;
    g.clear();
    g.fillStyle(DARK, 0.5).fillRect(0, 0, WORLD.w, WORLD.h);
    g.fillStyle(0xf2be3c, 0.11).fillCircle(WORLD.w / 2, WORLD.h / 2, 215);
    g.fillStyle(0xf2be3c, 0.13).fillCircle(WORLD.w / 2, WORLD.h / 2, 115);
  }

  /** What the HUD is allowed to know about the trip. Words and counts, no stats. */
  snapshot() {
    return {
      active: this.active,
      bug: this.bug ? { id: this.bug.id, name: this.bug.name } : null,
      finds: this.finds.map((f) => ({ said: f.said, rarity: f.rarity })),
    };
  }
}
