// Bundles the builder's modules and inlines them into tools/builder.html,
// producing a single self-contained dist/builder.html you can open straight
// from disk — no server, no network, nothing to install.
//
// The served copy imports src/ live, so it can never drift from the game. This
// one is a SNAPSHOT: rebuild it after touching genes, art, classification or
// the part catalogue, or it will quietly describe the old renderer.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'dist'), { recursive: true });

// The merge order has to match the one in builder.html — later modules win, and
// stats.js re-exports GENE_ORDER, so genes.js must not land on top of it.
const MODULES = [
  ['genes', 'core/genes.js'],
  ['archetypes', 'core/archetypes.js'],
  ['stats', 'core/stats.js'],
  ['classification', 'core/classification.js'],
  ['taxonBuild', 'core/taxonBuild.js'],
  ['bugArt', 'render/bugArt.js'],
  ['partLibrary', 'render/partLibrary.js'],
  ['rng', 'core/rng.js'],
];

const entry = resolve(root, 'dist/builder-entry.js');
writeFileSync(entry,
  MODULES.map(([name, path]) => `import * as ${name} from '../src/${path}';`).join('\n') +
  `\nglobalThis.BUGSIM = { ${MODULES.map(([n]) => `...${n}`).join(', ')} };\n`);

execSync('npx --yes esbuild@0.23.1 dist/builder-entry.js --bundle --format=iife ' +
         '--outfile=dist/builder-bundle.js',
  { cwd: root, stdio: 'inherit' });

const html = readFileSync(resolve(root, 'tools/builder.html'), 'utf8');
const js = readFileSync(resolve(root, 'dist/builder-bundle.js'), 'utf8');

const marker = '<script type="module">';
if (!html.includes(marker)) throw new Error('builder.html no longer has a module script');
const out = html.replace(marker, `<script>\n${js}\n</script>\n\n${marker}`);

writeFileSync(resolve(root, 'dist/builder.html'), out);

// A second copy named index.html, in a folder of its own. Static hosts serve
// the root as index.html, and dropping a file called builder.html on one gives
// you a 404 or — worse — the served copy, which then tries to fetch src/ off a
// host that has never heard of it. This folder is the thing to upload.
mkdirSync(resolve(root, 'dist/bug-builder'), { recursive: true });
cpSync(resolve(root, 'dist/builder.html'), resolve(root, 'dist/bug-builder/index.html'));

rmSync(entry, { force: true });
rmSync(resolve(root, 'dist/builder-bundle.js'), { force: true });
console.log(`wrote dist/builder.html (${(out.length / 1024).toFixed(0)} kB)`);
console.log('wrote dist/bug-builder/index.html — drag that folder to a static host');
