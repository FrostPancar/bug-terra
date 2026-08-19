# Third-party licences

## @samasante/liquid-glass — removed

`src/ui/glass.js`, a vanilla port of the framework-free half of
[`@samasante/liquid-glass`](https://github.com/samasante/liquid-glass) (MIT, ©
2026 Sam Asante), **is no longer in this project.** The circular glass dock it
powered was replaced by flat cut-paper controls when the terrarium moved to a
photographic floor: `backdrop-filter` bends whatever is painted behind an
element, and the design it was bending for no longer exists.

No code from that package remains in the tree, so there is nothing left to
attribute. This note is kept so the removal is visible in the record rather than
looking like the attribution was simply dropped.

## src/assets/dirt.jpg — provenance not recorded

The floor photograph was supplied by the project owner. **Its source and licence
are not known to this repository**, and nothing here should be read as a claim
that it is freely licensed.

It is embedded into `dist/terrarium.html` as a base64 data URI and copied into
`deploy/`, so it ships with every build — which makes this worth settling before
the site is published anywhere it has not already been. If it is a stock or
third-party image, record the licence here; if it was made for this project, say
so and pick a licence.

## Phaser 3 (v3.80.1)

MIT licensed, © Richard Davey / Phaser Studio. Vendored at
`deploy/vendor/phaser.min.js` and inlined into `dist/terrarium.html`.
