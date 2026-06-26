import { describe, it, expect } from 'vitest';
import {
  cToF,
  fToC,
  mToFt,
  mmToIn,
  msToKt,
  kmhToMs,
  deltaCToF,
  display,
  displayParts,
  SYSTEMS,
} from './units.js';

// ── Raw converters against known pairs ───────────────────────────────────────
describe('converters (known pairs)', () => {
  it('0°C → 32°F', () => expect(cToF(0)).toBeCloseTo(32, 9));
  it('100°C → 212°F', () => expect(cToF(100)).toBeCloseTo(212, 9));
  it('1000 m → 3281 ft', () => {
    expect(mToFt(1000)).toBeCloseTo(3280.84, 2);
    expect(Math.round(mToFt(1000))).toBe(3281);
  });
  it('25.4 mm → 1.00 in', () => expect(mmToIn(25.4)).toBeCloseTo(1.0, 9));
  it('1 m/s → 1.944 kt', () => expect(msToKt(1)).toBeCloseTo(1.94384, 5));

  it('round-trips and helpers', () => {
    expect(fToC(32)).toBeCloseTo(0, 9);
    expect(fToC(212)).toBeCloseTo(100, 9);
    expect(kmhToMs(3.6)).toBeCloseTo(1, 9);
    expect(deltaCToF(10)).toBeCloseTo(18, 9); // a 10°C difference == an 18°F difference
  });

  it('all converters are null-safe', () => {
    for (const f of [cToF, fToC, mToFt, mmToIn, msToKt, kmhToMs, deltaCToF]) {
      expect(f(null)).toBeNull();
    }
  });
});

// ── Registry formatting + precision ──────────────────────────────────────────
describe('display() formatting & precision', () => {
  it('matches the spec examples', () => {
    expect(display('height', 1524, 'imperial')).toBe('5,000 ft'); // 1524 m → 5000 ft
    expect(display('cape', 2400, 'imperial')).toBe('2,400 J/kg');
  });

  it('temperature → whole degrees', () => {
    expect(display('temperature', 0, 'imperial')).toBe('32 °F');
    expect(display('temperature', 37.78, 'imperial')).toBe('100 °F');
    expect(display('temperature', 0, 'metric')).toBe('0 °C');
  });

  it('heights → nearest 100 ft (imperial) / nearest 10 m (metric)', () => {
    expect(display('height', 1234, 'imperial')).toBe('4,000 ft'); // 4048 ft → 4000
    expect(display('height', 1234, 'metric')).toBe('1,230 m'); // 1234 → 1230
    // kft axis variant keeps one decimal
    expect(display('heightKft', 1524, 'imperial')).toBe('5.0 kft');
  });

  it('lapse rate → 1 dp, °F/1000 ft (imperial) vs °C/km (metric)', () => {
    expect(displayParts('lapseRate', 6.5, 'metric').text).toBe('6.5 °C/km');
    // 6.5 °C/km × 9/5 ÷ 3.28084 ≈ 3.57 → "3.6 °F/1000 ft"
    expect(display('lapseRate', 6.5, 'imperial')).toBe('3.6 °F/1000 ft');
  });

  it('PWAT → 2 dp inches (imperial) / 1 dp mm (metric)', () => {
    expect(display('pwat', 25.4, 'imperial')).toBe('1.00 in');
    expect(display('pwat', 25.4, 'metric')).toBe('25.4 mm');
  });

  it('shear/wind → whole kt (imperial) / 1 dp m/s (metric)', () => {
    expect(display('wind', 10, 'imperial')).toBe('19 kt'); // 10 m/s → 19.44 → 19
    expect(display('wind', 10, 'metric')).toBe('10.0 m/s');
  });

  it('surface wind → whole mph (imperial) / 1 dp m/s (metric)', () => {
    expect(display('windSurface', 10, 'imperial')).toBe('22 mph'); // 10 m/s → 22.37 → 22
    expect(display('windSurface', 10, 'metric')).toBe('10.0 m/s');
  });

  it('null/NaN → em dash', () => {
    expect(display('temperature', null, 'imperial')).toBe('—');
    expect(display('height', NaN, 'metric')).toBe('—');
  });

  it('unknown quantity key throws', () => {
    expect(() => display('bogus', 1, 'imperial')).toThrow(/Unknown quantity/);
  });
});

// ── Invariants: CAPE / CIN / pressure are byte-identical across systems ───────
describe('unit-invariant quantities', () => {
  const cases = [
    ['cape', 2415],
    ['cin', -47],
    ['pressure', 850],
  ];
  for (const [q, si] of cases) {
    it(`${q} is identical across imperial & metric`, () => {
      const imperial = display(q, si, 'imperial');
      const metric = display(q, si, 'metric');
      expect(imperial).toBe(metric);
    });
  }

  it('CAPE/CIN snap to nearest 10 J/kg', () => {
    expect(display('cape', 2415, 'imperial')).toBe('2,420 J/kg');
    expect(display('cin', -47, 'metric')).toBe('-50 J/kg');
  });

  it('pressure carries no conversion', () => {
    expect(display('pressure', 850, 'imperial')).toBe('850 hPa');
  });

  it('every quantity renders in every system without throwing', () => {
    const keys = ['temperature', 'tempDelt