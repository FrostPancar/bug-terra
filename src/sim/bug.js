// A bug entity: genome -> stats -> physics body + animator + behaviour.
// Note the direction of dependency. Stats are computed once from genes and
// then FEED the physics. Nothing here ever writes back into stats.

import { computeStats } from '../core/stats.js';
import { genomeId, genomeName } from '../core/genes.js';
import { bakeSpritesheet } from '../render/bugArt.js';
import { Animator } from './animator.js';

let uid = 0;

/** rgb triple -> 0xRRGGBB, pulled `k` of the way toward white (k=1 is white). */
function mixToWhite(rgb, k) {
  const m = rgb.map((c) => Math.round(c + (255 - c) * Math.max(0, Math.min(1, k))));
  return (m[0] << 16) | (m[1] << 8) | m[2];
}

export class Bug {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} genome
   * @param {{x:number,y:number,generation?:number,rng:Function}} opts
   */
  constructor(scene, genome, opts) {
    this.scene = scene;
    this.genome = genome;
    this.stats = computeStats(genome);
    this.id = ++uid;
    this.tag = genomeId(genome);
    this.name = genomeName(genome);
    this.generation = opts.generation ?? 0;
    this.rng = opts.rng;

    // --- texture ---
    const key = `bug-${this.tag}-${this.id}`;
    const sheet = bakeSpritesheet(genome, { ppu: 22 });
    const tex = scene.textures.addCanvas(key, sheet.canvas);
    for (let i = 0; i < sheet.total; i++) {
      tex.add(String(i), 0, i * sheet.frameW, 0, sheet.frameW, sheet.frameH);
    }
    tex.refresh();
    this.sheet = sheet;
    this.texKey = key;

    // --- sprite + physics body ---
    const radius = Math.max(7, sheet.frameW * 0.20 * this.stats.size * 0.6);
    this.sprite = scene.matter.add.sprite(opts.x, opts.y, this.texKey, '0', {
      shape: { type: 'circle', radius },
      frictionAir: 0.16 + (1 - this.stats.agility / 100) * 0.14,
      friction: 0.02,
      restitution: 0.25,
      mass: 0.4 + this.stats.mass * 0.5,
    });
    this.sprite.setFixedRotation();
    this.sprite.setDepth(10);
    this.sprite.setData('bug', this);
    this.radius = radius;

    // --- animation ---
    this.anim = new Animator(this.stats, sheet.frames);

    // --- runtime state (NOT genetics) ---
    this.hp = this.stats.health;
    this.energy = this.stats.stamina;
    this.facing = this.rng() * Math.PI * 2;
    this.target = null;
    this.wander = this.pickWanderPoint();
    this.thinkIn = this.rng() * 0.8;
    this.attackCooldown = 0;
    this.kills = 0;
    this.distance = 0;
    this.alive = true;
  }

  pickWanderPoint() {
    const b = this.scene.terrariumBounds;
    return {
      x: b.x + this.rng() * b.width,
      y: b.y + this.rng() * b.height,
    };
  }

  /** Movement force scale, straight from the speed stat. */
  get thrust() {
    return (0.00016 + this.stats.speed * 0.0000135) * this.sprite.body.mass;
  }

  get maxSpeed() {
    return 0.45 + this.stats.speed * 0.055;
  }

  nearestOther(bugs, range) {
    let best = null, bestD = range * range;
    for (const o of bugs) {
      if (o === this || !o.alive) continue;
      const dx = o.sprite.x - this.sprite.x;
      const dy = o.sprite.y - this.sprite.y;
      const d = dx * dx + dy * dy;
      // camouflage makes a bug harder to notice, more so in the dark
      const hide = 1 + (o.stats.camouflage / 100) * (0.3 + this.scene.env.stealthBonus * 0.9);
      if (d * (1 / hide) < bestD) { bestD = d * (1 / hide); best = o; }
    }
    return best;
  }

  think(dt, bugs) {
    this.thinkIn -= dt;
    if (this.thinkIn > 0) return;
    this.thinkIn = 0.25 + this.rng() * 0.35;

    const env = this.scene.env;
    const aggro = this.genome.aggression * env.aggressionBias;
    const tired = this.energy < this.stats.stamina * 0.25;

    if (!tired && aggro > 0.45) {
      const prey = this.nearestOther(bugs, this.stats.vision);
      // prefer targets it can plausibly beat
      if (prey && (aggro > 0.75 || prey.hp < this.hp * 1.15)) { this.target = prey; return; }
    }
    this.target = null;
    const d = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, this.wander.x, this.wander.y);
    if (d < 40 || this.rng() < 0.08) this.wander = this.pickWanderPoint();
  }

  update(dt, bugs) {
    if (!this.alive) return;
    const env = this.scene.env;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.think(dt, bugs);

    const goal = this.target && this.target.alive
      ? { x: this.target.sprite.x, y: this.target.sprite.y }
      : this.wander;

    const dx = goal.x - this.sprite.x;
    const dy = goal.y - this.sprite.y;
    const dist = Math.hypot(dx, dy) || 1;
    const tired = this.energy <= 0.5;
    const drive = tired ? 0.25 : env.activity;   // night slows everyone down

    // --- attack ---
    const reach = this.radius + (this.target?.radius ?? 0) + 6;
    if (this.target && this.target.alive && dist < reach && this.attackCooldown <= 0) {
      this.strike(this.target);
    } else if (dist > 4) {
      const f = this.thrust * drive;
      this.sprite.applyForce({ x: (dx / dist) * f, y: (dy / dist) * f });
    }

    // clamp to the speed the genes allow
    const v = this.sprite.body.velocity;
    const sp = Math.hypot(v.x, v.y);
    const cap = this.maxSpeed * drive;
    if (sp > cap) this.sprite.setVelocity((v.x / sp) * cap, (v.y / sp) * cap);

    // --- energy: moving costs, standing still recovers ---
    this.distance += sp * dt;
    this.energy = Math.max(0, Math.min(
      this.stats.stamina,
      this.energy - sp * dt * (0.9 + this.genome.metabolism * 1.4) + (sp < 0.15 ? this.stats.recovery * dt : 0)
    ));

    // --- animation state ---
    if (!this.anim.locked) this.anim.play(sp > 0.12 ? 'walk' : 'idle');
    this.sprite.setFrame(String(this.anim.update(dt)));

    // --- facing ---
    if (sp > 0.06) this.facing = Math.atan2(v.y, v.x);
    this.sprite.setRotation(this.facing);

    // --- lighting ---
    // Blend the ambient colour toward white so bugs stay readable at night;
    // the scene's overlay already carries most of the darkness.
    this.sprite.setTint(mixToWhite(env.rgb, 0.55 + env.light * 0.35));
  }

  strike(other) {
    this.anim.play('attack', { force: true });
    this.attackCooldown = 1 / this.stats.attackRate;
    const dmg = Math.max(1, this.stats.attack * 0.28 * (1 - other.stats.defense / 220));
    other.takeDamage(dmg, this);
    // knockback, scaled by the attacker's mass
    const a = Math.atan2(other.sprite.y - this.sprite.y, other.sprite.x - this.sprite.x);
    const k = 0.0009 * this.sprite.body.mass * (0.5 + this.stats.attack / 100);
    other.sprite.applyForce({ x: Math.cos(a) * k, y: Math.sin(a) * k });
    this.energy = Math.max(0, this.energy - 2);
  }

  takeDamage(amount, from) {
    this.hp -= amount;
    this.scene.flash(this.sprite.x, this.sprite.y);
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      if (from) from.kills++;
      this.scene.onBugDown(this);
    } else if (this.genome.aggression < 0.6 && from) {
      // flee
      this.target = null;
      const a = Math.atan2(this.sprite.y - from.sprite.y, this.sprite.x - from.sprite.x);
      this.wander = {
        x: this.sprite.x + Math.cos(a) * 260,
        y: this.sprite.y + Math.sin(a) * 260,
      };
    }
  }

  /** Everything the HUD wants to show. */
  snapshot() {
    return {
      id: this.id, tag: this.tag, name: this.name, generation: this.generation,
      genome: this.genome, stats: this.stats,
      hp: this.hp, energy: this.energy, kills: this.kills,
      distance: this.distance, alive: this.alive,
      state: this.anim.state,
    };
  }

  destroy() {
    this.sprite.destroy();
    if (this.scene.textures.exists(this.texKey)) this.scene.textures.remove(this.texKey);
  }
}
