// Tests for the semantic color vocabularies.
//
// Two properties matter here and neither is visible by eye-balling a mockup:
//
//   1. The published values are used EXACTLY. These palettes are already in the
//      reader's eyes from every AirNow map and radar loop; substituting nicer
//      hues silently breaks that calibration. Pinning the hexes makes a
//      well-meaning "let's soften this" edit fail loudly.
//
//   2. Every semantic fill clears WCAG AA with its auto-picked label. The
//      official palettes were designed as fills on WHITE maps and several fail
//      badly as colored text on this dark ground — which is exactly why the UI
//      only ever paints them as filled swatches.

import { describe, it, expect } from 'vitest';
import {
  AQI_BANDS,
  ALERT_SEVERITY,
  TIER_FILL,
  TEMP_STOPS,
  aqiBand,
  alertSeverity,
  contrast,
  readableOn,
  textSafeOn,
  precipFill,
  tempFill,
  REFLECTIVITY_STOPS,
} from './palette.js';

const SURFACE = '#1a202a'; // --surface-1, the card the chips sit on
const GROUND = '#12161d'; // --surface-0, the page
const ELEVATED = '#232b37'; // --surface-2

// Phase 4.1 ink tiers.
const INK_VALUE = '#f5f9fd'; // data numerals
const INK_0 = '#e9eff5'; // body text
const INK_1 = '#a6b6c4'; // secondary
const INK_2 = '#7c8c9a'; // faint / captions

describe('official color vocabularies are reproduced exactly', () => {
  it('uses EPA/AirNow AQI category colors', () => {
    expect(AQI_BANDS.map((b) => b.fill)).toEqual([
      '#00E400', // Good
      '#FFFF00', // Moderate
      '#FF7E00', // Unhealthy for Sensitive Groups
      '#FF0000', // Unhealthy
      '#8F3F97', // Very Unhealthy
      '#7E0023', // Hazardous
    ]);
  });

  it('maps AQI values to the right category', () => {
    expect(aqiBand(0).label).toBe('Good');
    expect(aqiBand(50).label).toBe('Good');
    expect(aqiBand(51).label).toBe('Moderate');
    expect(aqiBand(150).fill).toBe('#FF7E00');
    expect(aqiBand(201).label).toBe('Very Unhealthy');
    expect(aqiBand(500).label).toBe('Hazardous');
    expect(aqiBand(null).label).toBe('—');
  });

  it('uses NWS warning-red / watch-orange / advisory-yellow severity', () => {
    expect(alertSeverity('Severe').fill).toBe('#E60000');
    expect(alertSeverity('Moderate').fill).toBe('#FF8C00');
    expect(alertSeverity('Minor').fill).toBe('#E5C100');
    expect(alertSeverity('Unknown').fill).toBe('#78909C');
    expect(alertSeverity('nonsense').fill).toBe(ALERT_SEVERITY.Unknown.fill);
  });

  it('uses the NEXRAD reflectivity ramp, ascending green to magenta', () => {
    expect(REFLECTIVITY_STOPS[0].fill).toBe('#02FD02'); // 20 dBZ green
    expect(REFLECTIVITY_STOPS.at(-1).fill).toBe('#F800FD'); // 65 dBZ magenta
    const dbz = REFLECTIVITY_STOPS.map((s) => s.dbz);
    expect([...dbz].sort((a, b) => a - b)).toEqual(dbz);
  });
});

describe('every semantic fill is legible with its auto-picked label', () => {
  const fills = [
    ...AQI_BANDS.map((b) => [b.label, b.fill]),
    ...Object.entries(ALERT_SEVERITY).map(([k, v]) => [`alert ${k}`, v.fill]),
    ...Object.entries(TIER_FILL).map(([k, v]) => [`tier ${k}`, v]),
  ];

  it.each(fills)('%s clears WCAG AA as a filled swatch', (_label, fill) => {
    expect(contrast(readableOn(fill), fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('confirms the reason swatches are needed: several fail as text on the ground', () => {
    // If these ever start passing, the ground has been lightened and the
    // filled-swatch rule can be revisited. Until then it is load-bearing.
    expect(contrast('#8F3F97', SURFACE)).toBeLessThan(4.5); // EPA Very Unhealthy
    expect(contrast('#7E0023', SURFACE)).toBeLessThan(4.5); // EPA Hazardous
    expect(contrast('#E60000', SURFACE)).toBeLessThan(4.5); // NWS warning red
  });

  it('keeps the interactive accent outside every semantic ramp', () => {
    const accent = '#5AC8E0';
    const semantic = fills.map(([, f]) => f.toUpperCase());
    expect(semantic).not.toContain(accent);
    expect(contrast(accent, SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('ink tiers (Phase 4.1)', () => {
  const surfaces = [
    ['ground', GROUND],
    ['card', SURFACE],
    ['elevated', ELEVATED],
  ];

  it.each(surfaces)('--ink-value clears AA on %s', (_n, bg) => {
    expect(contrast(INK_VALUE, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('--ink-1 (secondary) clears AA on %s', (_n, bg) => {
    expect(contrast(INK_1, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('--ink-2 (caption tier) clears AA on %s', (_n, bg) => {
    // The caption tier is where dark dashboards usually fail. On the elevated
    // surface it is the tightest pairing in the system, so this is the
    // assertion that constrains how light --surface-2 may become.
    expect(contrast(INK_2, bg)).toBeGreaterThanOrEqual(4.0);
  });

  it('keeps values brighter than body prose — the instrument hierarchy', () => {
    expect(contrast(INK_VALUE, SURFACE)).toBeGreaterThan(contrast(INK_0, SURFACE));
  });
});

describe('temperature ramp as headline text is gated per-value', () => {
  it('permits mid-range stops, which genuinely pass', () => {
    for (const c of [-10, 0, 10, 20, 30]) {
      expect(textSafeOn(tempFill(c), SURFACE, 4.5)).toBeTruthy();
      expect(contrast(tempFill(c), SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('REFUSES the extremes, which fail — this is why the gate exists', () => {
    // -30 C is 1.28:1 and +40 C is 2.89:1 on the card. An unconditional tint
    // would make the most extreme temperatures the least readable numbers on
    // the page, which is the opposite of what a tint is for.
    for (const c of [-40, -30, -20, 40, 50]) {
      expect(textSafeOn(tempFill(c), SURFACE, 4.5)).toBeNull();
    }
  });

  it('never returns a color it would not also pass the contrast check for', () => {
    for (const s of TEMP_STOPS) {
      const allowed = textSafeOn(s.fill, SURFACE, 4.5);
      if (allowed) expect(contrast(allowed, SURFACE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is null-safe', () => {
    expect(textSafeOn(null, SURFACE)).toBeNull();
    expect(textSafeOn(tempFill(null), SURFACE)).toBeNull();
  });
});

describe('precipitation intensity → reflectivity color', () => {
  it('paints nothing for a dry or trace hour', () => {
    expect(precipFill(0)).toBeNull();
    expect(precipFill(null)).toBeNull();
    expect(precipFill(0.02)).toBeNull();
  });

  it('escalates green → yellow → red as rate increases', () => {
    const light = precipFill(0.6);
    const moderate = precipFill(4);
    const heavy = precipFill(30);
    expect(light).toBeTruthy();
    expect(moderate).toBeTruthy();
    expect(heavy).toBeTruthy();
    const order = REFLECTIVITY_STOPS.map((s) => s.fill);
    expect(order.indexOf(light)).toBeLessThan(order.indexOf(moderate));
    expect(order.indexOf(moderate)).toBeLessThan(order.indexOf(heavy));
  });
});

describe('temperature ramp', () => {
  it('runs cold-blue to hot-red and interpolates between stops', () => {
    expect(tempFill(-40)).toBe('#4B0F7A');
    expect(tempFill(50)).toBe('#C42B1C');
    expect(tempFill(null)).toBeNull();
    // A midpoint must be a genuine blend, not snapped to either endpoint.
    const mid = tempFill(5);
    expect(mid).not.toBe(tempFill(0));
    expect(mid).not.toBe(tempFill(10));
  });
});
