# Bug-Terra Color Palette

Reference palette for procedural bug rendering. These colors are used for lighting effects, pattern overlays, and accents.

## Reference Palette (REF_PALETTE)

| Index | Name | Hex | RGB |
|-------|------|-----|-----|
| 0 | tan | `#C19D76` | (193, 157, 118) |
| 1 | brown | `#594637` | (89, 70, 55) |
| 2 | rust | `#bf5640` | (191, 86, 64) |
| 3 | orange | `#d76334` | (215, 99, 52) |
| 4 | gold | `#EEBA38` | (238, 186, 56) |
| 5 | sage | `#3F9A6F` | (63, 154, 111) |
| 6 | teal | `#2CA68A` | (44, 166, 138) |
| 7 | cream | `#e5dbcf` | (229, 219, 207) |
| 8 | pink | `#EDA6AD` | (237, 166, 173) |
| 9 | blue | `#3D56C6` | (61, 86, 198) |
| 10 | charcoal | `#2B2A2A` | (43, 42, 42) |
| 11 | lavender | `#B98BE3` | (185, 139, 227) |

## Usage

**DESIGN MANDATE**: Lighting colours are always drawn from this fixed reference palette, never computed from the body hue. The reference art puts consistent warm lighting on every creature regardless of body colour — so the bloom colour is a constant, looked up from this table.

Palette order (REF_PALETTE_ORDER): `tan, brown, rust, orange, gold, sage, teal, cream, pink, blue, charcoal, lavender`

- **`light_hue`** (0-11): Selects the segment bloom colour (the soft light on body segments)
- **`pattern_horn_hue`** (0-11): Decoration colour for horn patterns
- **`pattern_mandible_hue`** (0-11): Decoration colour for mandible patterns
- **`pattern_leg_hue`** (0-11): Gradient foot-end colour (unused unless gradient pattern selected)
- **`pattern_shell_hue`** (0-11): Shell marking colour
- **`crown_mark_hue`** (0-11): Crown mark colour (default gold = index 4)
- **`wing_tip_hue`** (0-10): Wing tip wash colour (0 = white, 1-10 map to palette indices 0-9)

## Implementation Notes

- Stored in `src/render/bugArt.js` as `REF_PALETTE` object and `REF_PALETTE_ORDER` array
- Order is fixed to maintain genome compatibility — adding colours anywhere but the end breaks genome indices
- The colour order in `REF_PALETTE_ORDER` must match the hex definitions in `REF_PALETTE`
- Only HUE comes from the palette for pattern overlays; saturation and lightness are derived from the piece's colour and `pattern_contrast` gene
