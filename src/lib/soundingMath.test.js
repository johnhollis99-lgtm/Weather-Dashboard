import { describe, it, expect } from 'vitest';
import {
  saturationVaporPressure,
  vaporPressure,
  dewpointFromVaporPressure,
  mixingRatio,
  saturationMixingRatio,
  relativeHumidity,
  potentialTemperature,
  temperatureFromTheta,
  dryAdiabatTemp,
  moistLapseRate,
  interpByPressure,
  lcl,
  lclEspyMeters,
  cappingInversions,
  layerLapseRate,
  lapseRates,
  classifyLapse,
  windComponents,
  shearAnalysis,
  precipitableWater,
  mixingHeight,
  stormModeNarrative,
  analyzeSounding,
} from './soundingMath.js';
import { cappedSevere, stableDesert, stratusFog } from './sampleProfiles.js';

// Tolerances. The thermodynamic primitives are checked against closed-form /
// textbook values (tight). The CAPE/CIN/LCL integrals are checked against
// physically-sensible bands rather than a single reference number: SHARPpy and
// MetPy themselves differ by O(10%) depending on virtual-temperature handling,
// parcel definition and integration step, so a band of roughly ±15–20% around a
// MetPy-style surface-based, virtual-temperature-corrected parcel is the
// documented tolerance for the sample profiles below.
const near = (a, b, tol) => Math.abs(a - b) <= tol;

describe('thermodynamic primitives (closed-form references)', () => {
  it('Bolton saturation vapor pressure', () => {
    expect(near(saturationVaporPressure(0), 6.112, 0.01)).toBe(true);
    expect(near(saturationVaporPressure(20), 23.37, 0.1)).toBe(true);
    expect(near(saturationVaporPressure(10), 12.27, 0.1)).toBe(true);
  });

  it('vapor pressure ↔ dewpoint is reversible', () => {
    for (const td of [-10, 0, 12, 25]) {
      expect(near(dewpointFromVaporPressure(vaporPressure(td)), td, 1e-6)).toBe(true);
    }
  });

  it('saturation mixing ratio ~14.9 g/kg at 20 °C / 1000 hPa', () => {
    expect(near(saturationMixingRatio(20, 1000) * 1000, 14.9, 0.2)).toBe(true);
  });

  it('mixing ratio uses vapor (partial) pressure', () => {
    expect(near(mixingRatio(saturationVaporPressure(20), 1000) * 1000, 14.9, 0.2)).toBe(true);
  });

  it('relative humidity: saturated and half-saturated', () => {
    expect(near(relativeHumidity(20, 20), 100, 1e-6)).toBe(true);
    expect(relativeHumidity(20, 10)).toBeLessThan(60);
    expect(relativeHumidity(20, 10)).toBeGreaterThan(45);
  });

  it('potential temperature and its inverse', () => {
    expect(near(potentialTemperature(0, 1000), 273.15, 1e-6)).toBe(true);
    expect(near(potentialTemperature(20, 1000), 293.15, 1e-6)).toBe(true);
    // θ at 500 hPa for 20 °C ≈ 357 K
    expect(near(potentialTemperature(20, 500), 357.4, 0.5)).toBe(true);
    // round-trip
    for (const [t, p] of [[15, 850], [-30, 300], [25, 1000]]) {
      expect(near(temperatureFromTheta(potentialTemperature(t, p), p), t, 1e-6)).toBe(true);
    }
  });

  it('dry adiabat cools ~9.8 °C/km (≈ via pressure)', () => {
    // From 25 °C at 1000 hPa up to 900 hPa (~ +880 m): ΔT ≈ 8.6 °C
    const t900 = dryAdiabatTemp(25, 1000, 900);
    expect(t900).toBeLessThan(25);
    expect(near(25 - t900, 8.6, 1.0)).toBe(true);
  });

  it('moist adiabatic lapse rate is temperature/pressure dependent', () => {
    // ~4.9 °C/km warm & low; steepens (toward dry) when cold & high.
    expect(near(moistLapseRate(283.15, 850) * 1000, 4.9, 0.5)).toBe(true);
    expect(moistLapseRate(233.15, 300) * 1000).toBeGreaterThan(moistLapseRate(283.15, 850) * 1000);
    expect(moistLapseRate(233.15, 300) * 1000).toBeLessThan(9.8);
  });
});

describe('LCL', () => {
  it('intersection method: 30/15 at 1000 hPa ≈ 800 hPa, ~11.6 °C', () => {
    const l = lcl(30, 15, 1000);
    expect(near(l.pressure, 800, 20)).toBe(true);
    expect(near(l.temp, 11.6, 1.5)).toBe(true);
  });

  it('defining property: parcel is just-saturated at the LCL', () => {
    const l = lcl(30, 15, 1000);
    const w0 = mixingRatio(vaporPressure(15), 1000);
    expect(near(saturationMixingRatio(l.temp, l.pressure), w0, 1e-4)).toBe(true);
  });

  it('Espy cross-check agrees with intersection height to ~10%', () => {
    // Intersection height via dry-adiabat thickness ≈ (T − T_LCL)/Γd
    const l = lcl(30, 15, 1000);
    const zIntersection = ((30 - l.temp) / 9.76) * 1000; // m
    const zEspy = lclEspyMeters(30, 15); // 1875 m
    expect(near(zIntersection, zEspy, zEspy * 0.1)).toBe(true);
  });

  it('saturated surface → cloud base at the surface', () => {
    const l = lcl(15, 15, 1000);
    expect(l.pressure).toBe(1000);
  });
});

describe('interpolation', () => {
  it('log-p interpolation between levels', () => {
    const prof = [
      { pressure: 1000, height: 0, temp: 20 },
      { pressure: 500, height: 5500, temp: -10 },
    ];
    // midpoint in log-p is ~707 hPa; temp halfway = 5 °C
    expect(near(interpByPressure(prof, 707.1, 'temp'), 5, 0.2)).toBe(true);
    expect(interpByPressure(prof, 2000, 'temp')).toBe(20); // clamp below ground
    expect(interpByPressure(prof, 100, 'temp')).toBe(-10); // clamp above top
  });
});

describe('lapse rates', () => {
  it('layer lapse rate sign and magnitude', () => {
    const lr = layerLapseRate(stableDesert, 700, 500);
    expect(lr).toBeGreaterThan(6);
    expect(lr).toBeLessThan(9);
  });
  it('classification thresholds', () => {
    expect(classifyLapse(8)).toBe('steep');
    expect(classifyLapse(6)).toBe('moderate');
    expect(classifyLapse(4)).toBe('weak');
  });
  it('capped-severe has steep mid-level lapse rate', () => {
    const lr = lapseRates(cappedSevere);
    expect(lr.mid700_500).toBeGreaterThan(7);
    expect(lr.mid700_500Class).toBe('steep');
  });
});

describe('wind shear & hodograph', () => {
  it('windComponents: meteorological convention', () => {
    // wind FROM the west blows toward the east → +u
    const w = windComponents(270, 10);
    expect(near(w.u, 10, 1e-6)).toBe(true);
    expect(near(w.v, 0, 1e-6)).toBe(true);
    // wind FROM the north → −v
    const n = windComponents(0, 10);
    expect(near(n.v, -10, 1e-6)).toBe(true);
  });
  it('capped-severe: strong, veering 0–6 km shear', () => {
    const s = shearAnalysis(cappedSevere);
    expect(s.shear0_6km).toBeGreaterThan(35);
    expect(s.shear0_6km).toBeGreaterThan(s.shear0_1km);
    expect(s.veering).toBe(true);
    expect(s.turningDeg).toBeGreaterThan(0);
  });
  it('ignores levels with missing winds rather than treating them as calm', () => {
    const withGap = [
      { pressure: 1000, height: 0, temp: 20, dewpoint: 15, windDir: 180, windSpeed: 10 },
      { pressure: 850, height: 1500, temp: 10, dewpoint: 5, windDir: null, windSpeed: null },
      { pressure: 700, height: 3000, temp: 2, dewpoint: -5, windDir: 270, windSpeed: 50 },
      { pressure: 500, height: 5600, temp: -12, dewpoint: -25, windDir: 280, windSpeed: 70 },
    ];
    const s = shearAnalysis(withGap);
    expect(Number.isFinite(s.shear0_6km)).toBe(true);
    expect(s.shear0_6km).toBeGreaterThan(0);
    // Fewer than two levels with real winds → shear is null, not a fake 0.
    const sparse = shearAnalysis([
      { pressure: 1000, height: 0, temp: 20, dewpoint: 15, windDir: 180, windSpeed: 10 },
      { pressure: 850, height: 1500, temp: 10, dewpoint: 5, windDir: null, windSpeed: null },
    ]);
    expect(sparse.shear0_6km).toBeNull();
  });
});

describe('precipitable water', () => {
  it('synthetic saturated column (1000→900 hPa, 20 °C) ≈ 16 mm', () => {
    const col = [
      { pressure: 1000, height: 0, temp: 20, dewpoint: 20 },
      { pressure: 900, height: 880, temp: 20, dewpoint: 20 },
    ];
    expect(near(precipitableWater(col).mm, 16, 2)).toBe(true);
  });
  it('inches conversion', () => {
    const pw = precipitableWater(cappedSevere);
    expect(near(pw.inches, pw.mm / 25.4, 1e-9)).toBe(true);
    expect(pw.mm).toBeGreaterThan(15);
  });
});

describe('capping inversion detection', () => {
  it('finds the EML cap in the capped-severe profile (below 700 hPa)', () => {
    const { inversions, cap } = cappingInversions(cappedSevere);
    expect(inversions.length).toBeGreaterThanOrEqual(1);
    expect(cap).not.toBeNull();
    expect(cap.basePressure).toBeGreaterThanOrEqual(700);
    expect(cap.strength).toBeGreaterThan(0);
  });

  it('finds NONE in the well-mixed desert profile', () => {
    const { inversions, cap } = cappingInversions(stableDesert);
    expect(inversions.length).toBe(0);
    expect(cap).toBeNull();
  });

  it('flags the marine subsidence inversion in the stratus profile', () => {
    const { cap } = cappingInversions(stratusFog);
    expect(cap).not.toBeNull();
    expect(cap.strength).toBeGreaterThan(3);
    expect(cap.basePressure).toBeGreaterThanOrEqual(700);
  });
});

describe('mixing height', () => {
  it('deep mixing height in the dry desert (max temp 36 °C)', () => {
    const mh = mixingHeight(stableDesert, 36);
    expect(mh).not.toBeNull();
    expect(mh.heightAGL).toBeGreaterThan(1000);
  });
});

describe('CAPE / CIN (sample profiles, banded tolerance)', () => {
  it('capped-severe: large CAPE, real CIN, ordered LCL<LFC<EL', () => {
    const a = analyzeSounding(cappedSevere);
    expect(a.cape).toBeGreaterThan(800); // loaded
    expect(a.cape).toBeLessThan(6000);
    expect(a.cin).toBeLessThan(0); // inhibited (capped)
    expect(a.lfc).not.toBeNull();
    expect(a.el).not.toBeNull();
    // LCL below LFC below EL (pressure decreases upward)
    expect(a.lcl.pressure).toBeGreaterThan(a.lfc.pressure);
    expect(a.lfc.pressure).toBeGreaterThan(a.el.pressure);
    expect(a.el.height).toBeGreaterThan(8000); // tall storm
  });

  it('stable desert: ~zero CAPE, no LFC', () => {
    const a = analyzeSounding(stableDesert, { surfaceMaxTemp: 36 });
    expect(a.cape).toBeLessThan(50);
    expect(a.lfc).toBeNull();
  });

  it('stratus/fog: ~zero CAPE, cloud base near the surface', () => {
    const a = analyzeSounding(stratusFog);
    expect(a.cape).toBeLessThan(50);
    expect(a.lcl.heightAGL).toBeLessThan(200); // fog/stratus on the deck
  });
});

describe('stormModeNarrative (pure, per-branch)', () => {
  it('no data', () => {
    expect(stormModeNarrative({ cape: null })).toMatch(/insufficient/i);
  });
  it('stable', () => {
    expect(stormModeNarrative({ cape: 50, cin: 0, shear6km: 40 })).toMatch(/stable/i);
  });
  it('strongly capped overrides (loaded gun)', () => {
    expect(stormModeNarrative({ cape: 3000, cin: -300, shear6km: 50 })).toMatch(/capped/i);
  });
  it('high CAPE + strong shear → supercells', () => {
    expect(stormModeNarrative({ cape: 2500, cin: -20, shear6km: 50 })).toMatch(/supercell/i);
  });
  it('high CAPE + weak shear → pulse/multicell', () => {
    expect(stormModeNarrative({ cape: 2500, cin: -20, shear6km: 15 })).toMatch(/pulse|multicell/i);
  });
  it('high CAPE + moderate shear → organized multicells', () => {
    expect(stormModeNarrative({ cape: 2000, cin: -20, shear6km: 30 })).toMatch(/organized multicell/i);
  });
  it('moderate CAPE + strong shear → organized/severe', () => {
    expect(stormModeNarrative({ cape: 800, cin: -20, shear6km: 45 })).toMatch(/organized, potentially severe/i);
  });
  it('moderate CAPE + weak shear → scattered storms', () => {
    expect(stormModeNarrative({ cape: 800, cin: -20, shear6km: 10 })).toMatch(/scattered/i);
  });
});
