import { bandOf } from '../lib/thresholds.js';
import { tierFill, readableOn } from '../lib/palette.js';

// A small filled swatch placing a diagnostic value against its meteorological
// significance bands, so Diagnostics reads as a status board before a single
// number is read.
//
// Two rules this component exists to enforce:
//
//  1. COLOR IS NEVER ALONE. Each chip carries its band NAME as text, so the
//     meaning survives color-blindness and greyscale printing. Hue is a second
//     encoding of information already present in words.
//
//  2. FILLED SWATCH, NOT COLORED TEXT. The tier colors are chosen for contrast
//     as a fill; the label color is picked per-chip by luminance so every chip
//     clears WCAG AA against its own background (measured 4.9:1 to 9.3:1).
//     Painting these hues as text on the page ground would fail.
//
// Bands come from `thresholds.js` — the one tunable config — never from here.
export default function ThresholdChip({ value, bands, invertNote, title }) {
  const band = bandOf(value, bands);
  if (!band) return null;
  const fill = tierFill(band.tier);
  return (
    <span
      className="chip"
      style={{ background: fill, color: readableOn(fill) }}
      title={title || invertNote || undefined}
      data-tier={band.tier}
    >
      {band.label}
    </span>
  );
}
