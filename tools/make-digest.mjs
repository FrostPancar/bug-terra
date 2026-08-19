// Packages the repo into a few self-contained markdown files suitable for
// Claude Project knowledge.
//
// Why not just upload the repo: project knowledge wants readable text, and most
// of this tree by weight is generated or vendored — dist/terrarium.html (1.2 MB,
// built), deploy/ (staged copies of src/), vendor/phaser.min.js (1.2 MB, third
// party), node_modules. Uploading those buries the ~180 KB that actually
// describes the project. This emits only hand-written source, with paths.

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'digest');
mkdirSync(outDir, { recursive: true });

const LANG = {
  '.js': 'javascript', '.mjs': 'javascript', '.json': 'json',
  '.html': 'html', '.toml': 'toml', '.md': 'markdown',
};

const read = (p) => readFileSync(resolve(root, p), 'utf8');
const size = (p) => statSync(resolve(root, p)).size;

function section(path) {
  const lang = LANG[extname(path)] ?? '';
  const body = read(path);
  // A markdown file inside a fence needs a longer fence than anything it holds.
  const fence = body.includes('```') ? '`````' : '```';
  return `\n## \`${path}\`\n\n${fence}${lang}\n${body}\n${fence}\n`;
}

function build(name, title, intro, files) {
  const total = files.reduce((n, f) => n + size(f), 0);
  const tree = files.map((f) => `- \`${f}\` — ${(size(f) / 1024).toFixed(1)} KB`).join('\n');
  const doc = `# ${title}\n\n${intro}\n\n**Files in this document (${files.length}, `
    + `${(total / 1024).toFixed(0)} KB):**\n\n${tree}\n\n---\n`
    + files.map(section).join('\n---\n');
  writeFileSync(resolve(outDir, name), doc);
  console.log(`${name.padEnd(34)} ${files.length} files, ${(doc.length / 1024).toFixed(0)} KB`);
}

const INTRO = `Part of **bug-terra** — a procedural bug generator: a gene vector
per bug produces deterministic gameplay stats, a genetic algorithm breeds them,
and they live in a 2D terrarium with Matter.js physics, sprite animation and a
day/night cycle synced to the real system clock.

The architectural rule that matters: **stats are a pure function of genes.**
Nothing in the simulation ever writes back into them. Genes feed stats; stats
feed physics, animation rates and fitness. The arrow never reverses.`;

build('01-core-genetics.md', 'bug-terra — genetics, stats and breeding',
  `${INTRO}\n\nThis document holds the pure logic: no DOM, no Phaser, no
rendering. Everything here runs in plain Node and is covered by the test suite.`,
  [
    'src/core/rng.js',
    'src/core/genes.js',
    'src/core/genes.schema.json',
    'src/core/archetypes.js',
    'src/core/stats.js',
    'src/core/breeding.js',
  ]);

build('02-simulation-and-render.md', 'bug-terra — simulation and rendering',
  `${INTRO}\n\nThis document holds the Phaser scene, the bug entity, the
procedural art, the animation state machine, the day/night clock and the
viewport policy.`,
  [
    'src/render/bugArt.js',
    'src/sim/bug.js',
    'src/sim/terrarium.js',
    'src/sim/animator.js',
    'src/sim/dayNight.js',
    'src/sim/viewport.js',
  ]);

build('03-ui-and-chrome.md', 'bug-terra — UI, chrome and boot',
  `${INTRO}\n\nThis document holds the page shell, the HUD wiring, and the
flat cut-paper controls that sit over the terrarium.`,
  [
    'index.html',
    'src/main.js',
    'src/ui/chrome.js',
  ]);

build('04-tests-and-tooling.md', 'bug-terra — tests, tooling and config',
  `${INTRO}\n\nThis document holds the test suite, the build/stage scripts, the
browser-based viewport and interaction tests, and the project config.`,
  [
    'tests/core.test.js',
    'tools/build-single.mjs',
    'tools/stage-deploy.mjs',
    'tools/viewport-test.mjs',
    'tools/interaction-test.mjs',
    'tools/gallery.html',
    'package.json',
    'netlify.toml',
  ]);

console.log(`\nwrote ${outDir}`);
