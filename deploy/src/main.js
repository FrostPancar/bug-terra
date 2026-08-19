// Boot + HUD wiring.

import { TerrariumScene, WORLD } from './sim/terrarium.js';
import { GENE_ORDER } from './core/genes.js';
import { STAT_KEYS, FITNESS } from './core/stats.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: WORLD.w,
  height: WORLD.h,
  backgroundColor: '#120d09',
  physics: { default: 'matter', matter: { gravity: { y: 0 }, debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [TerrariumScene],
});

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => Number(n).toFixed(d);

let scene = null;
game.events.once('ready', () => {
  scene = game.scene.getScene('terrarium');
  scene.events.on('state', render);
  wire();
});

/* ------------------------------------------------------------ render ---- */

function bar(label, value, max, unit = '') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="row"><span class="k">${label}</span>
    <span class="track"><i style="width:${pct}%"></i></span>
    <span class="v">${fmt(value, value < 10 ? 2 : 0)}${unit}</span></div>`;
}

function render(s) {
  $('clock').textContent = s.clock;
  $('phase').textContent = s.env.label;
  $('phase').style.color = s.env.css;
  $('gen').textContent = s.generation;
  $('alive').textContent = `${s.alive}/${s.total}`;
  $('seedOut').textContent = s.seed;
  $('bestFit').textContent = fmt(s.bestFitness);
  $('meanFit').textContent = fmt(s.meanFitness);
  $('sun').style.background = s.env.css;

  const b = s.selected;
  if (!b) { $('inspect').innerHTML = '<p class="muted">Click a bug.</p>'; return; }

  $('inspect').innerHTML = `
    <h3>${b.name} <span class="muted">#${b.tag}</span>${b.alive ? '' : ' <span class="dead">DOWN</span>'}</h3>
    <p class="muted small">gen ${b.generation} · ${b.state} · ${b.kills} kills · ${fmt(b.distance, 0)} travelled</p>
    <div class="bars">
      ${bar('HP', b.hp, b.stats.health)}
      ${bar('Energy', b.energy, b.stats.stamina)}
    </div>
    <h4>Stats <span class="muted small">(pure f(genes))</span></h4>
    <div class="bars">
      ${STAT_KEYS.filter((k) => k !== 'size' && k !== 'attackRate' && k !== 'vision')
        .map((k) => bar(k, b.stats[k], 100)).join('')}
      ${bar('vision', b.stats.vision, 280)}
      ${bar('bites/s', b.stats.attackRate, 2.6)}
    </div>
    <h4>Genes</h4>
    <div class="genes">
      ${GENE_ORDER.map((k) => `<span class="gene"><b>${k}</b>${fmt(b.genome[k], 2)}</span>`).join('')}
    </div>`;
}

/* -------------------------------------------------------------- wire ---- */

function wire() {
  $('preset').innerHTML = Object.keys(FITNESS)
    .map((k) => `<option value="${k}">${k}</option>`).join('');
  $('preset').value = scene.preset;
  $('preset').onchange = (e) => { scene.preset = e.target.value; scene.emitState(); };

  $('breed').onclick = () => scene.breed();
  $('ff').onclick = () => scene.fastForward(Number($('ffN').value) || 10);
  $('reseed').onclick = () => scene.reseed();
  $('pause').onclick = (e) => {
    const paused = scene.matter.world.enabled;
    scene.matter.world.enabled = !paused;
    e.target.textContent = paused ? 'Resume' : 'Pause';
  };

  $('pop').oninput = (e) => { $('popOut').textContent = e.target.value; };
  $('pop').onchange = (e) => { scene.popSize = Number(e.target.value); scene.reseed(scene.seed); };

  $('tscale').oninput = (e) => {
    scene.timeScale = Number(e.target.value);
    $('tscaleOut').textContent = scene.timeScale === 1 ? 'real time' : `${scene.timeScale}×`;
  };

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'b') scene.breed();
    if (ev.key === 'r') scene.reseed();
  });
}
