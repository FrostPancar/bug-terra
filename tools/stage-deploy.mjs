// Rebuilds deploy/ from source. Run after `npm run build`.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'deploy');
const keep = readFileSync(resolve(out, 'netlify.toml'), 'utf8');

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, 'vendor'), { recursive: true });

cpSync(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });
cpSync(resolve(root, 'dist/terrarium.html'), resolve(out, 'index.html'));
cpSync(resolve(root, 'README.md'), resolve(out, 'README.md'));
cpSync(resolve(root, 'node_modules/phaser/dist/phaser.min.js'),
       resolve(out, 'vendor/phaser.min.js'));
writeFileSync(resolve(out, 'netlify.toml'), keep);

// dev.html = index.html source, but pointed at the vendored Phaser
writeFileSync(resolve(out, 'dev.html'),
  readFileSync(resolve(root, 'index.html'), 'utf8').replace(
    /<script src="https:\/\/cdnjs[^"]*"><\/script>/,
    '<script src="./vendor/phaser.min.js"></script>'));

// dev-only sheets: the archetype gallery and the part-by-part builder
cpSync(resolve(root, 'tools/gallery.html'), resolve(out, 'gallery.html'));
cpSync(resolve(root, 'tools/builder.html'), resolve(out, 'builder.html'));
cpSync(resolve(root, 'tools/hero.html'), resolve(out, 'hero.html'));

console.log('staged deploy/');
