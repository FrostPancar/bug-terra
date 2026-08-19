# Third-party licences

## @samasante/liquid-glass (v0.1.1)

The glass buttons in `src/ui/glass.js` are a **vanilla port** of the
framework-free half of [`@samasante/liquid-glass`](https://github.com/samasante/liquid-glass)
by Sam Asante.

The upstream package is a React component (React is a peer dependency) and this
project has no React, so rather than pull in a framework for four buttons, the
parts that aren't React were ported to plain DOM:

- the signed-distance-field displacement-map rasterizer from `src/displacement.ts`
  — dome (spherical-cap) profile, meniscus bump, directional sheen, inner glow,
  soft-edge erf feather, and the quadrant-mirrored encode
- the SVG filter chain from `src/Glass.tsx` — flood → feImage map → optional
  frost blur → 3-pass RGB-split `feDisplacementMap` → specular composite
- the `GlassOptics` vocabulary and its default values

Not ported: the React component and hooks, WebGL/video surfaces, motion-value
plumbing, the `refract`/`behind` copy modes, and the Safari filter-id
cache-busting (this port installs its filters once and doesn't animate geometry,
so it doesn't hit that bug).

Upstream is MIT licensed:

```
MIT License

Copyright (c) 2026 Sam Asante

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Phaser 3 (v3.80.1)

MIT licensed, © Richard Davey / Phaser Studio. Vendored at
`deploy/vendor/phaser.min.js` and inlined into `dist/terrarium.html`.
