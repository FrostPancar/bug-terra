// Bundles src/main.js and inlines it — plus Phaser itself — into index.html,
// producing a single self-contained terrarium.html you can open straight from
// disk with no server and no network.
// Requires `npm i` first (phaser is a devDependency used only for this inline).

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(resolve(root, 'dist'), { recursive: true });
execSync('npx --yes esbuild@0.23.1 src/main.js --bundle --format=iife --outfile=dist/bundle.js',
  { cwd: root, stdio: 'inherit' });

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const js = readFileSync(resolve(root, 'dist/bundle.js'), 'utf8');

const phaser = readFileSync(resolve(root, 'node_modules/phaser/dist/phaser.min.js'), 'utf8');

const out = html
  .replace(/<script src="https:\/\/cdnjs[^"]*"><\/script>/,
    `<script>\n${phaser}\n</script>`)
  .replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/,
    `<script>\n${js}\n</script>`);

writeFileSync(resolve(root, 'dist/terrarium.html'), out);
console.log('wrote dist/terrarium.html');
