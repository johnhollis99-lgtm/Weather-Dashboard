import { describe, expect, it } from 'vitest';
import {
  IEM_OFFSETS_MIN,
  LEGEND_NOTE,
  STALE_THRESHOLD_MIN,
  buildIemFrames,
  buildLegend,
  buildRainviewerFrames,
  classifyFreshness,
  evaluateStaleness,
  iemProduct,
  iemTileUrl,
  reconcileFrameIndex,
} from './radar.js';
import { REFLECTIVITY_STOPS } from './palette.js';

// The radar panel's decision logic. These rules are the difference between a
// loop that reports what it knows and one that quietly renders an hour-old sky
// as current — the failure this codebase already paid for once.

const NOW = Date.parse('2026-08-11T12:00:00Z');

describe('IEM frame construction', () => {
  it('names the relative products the way IEM does', () => {
    // Verified against the live service: offset 0 is the bare product; the rest
    // are zero-padded "minus N minutes".
    expect(iemProduct(0)).toBe('nexrad-n0q');
    expect(iemProduct(5)).toBe('nexrad-n0q-m05m');
    expect(iemProduct(55)).toBe('nexrad-n0q-m55m');
  });

  it('covers the past 55 minutes at 5-minute steps, oldest first', () => {
    const f = buildIemFrames(NOW);
    expect(f).toHaveLength(12);
    expect(f[0].offsetMin).toBe(55);
    expect(f[f.length - 1].offsetMin).toBe(0);
    const steps = f.slice(1).map((x, i) => f[i].offsetMin - x.offsetMin);
    expect(new Set(steps)).toEqual(new Set([5]));
    expect(IEM_OFFSETS_MIN).toHaveLength(12);
  });

  it('derives times from the caller clock and marks them DERIVED', () => {
    // The whole honesty story rests on this flag: IEM publishes no product time,
    // so nothing downstream may present these as observed.
    const f = buildIemFrames(NOW);
    expect(f[f.length - 1].time).toBe(NOW);
    expect(f[0].time).toBe(NOW - 55 * 60_000);
    expect(f.every((x) => x.timeBasis === 'derived')).toBe(true);
  });

  it('cache-busts so a refresh cannot be served the previous tick from cache', () => {
    // The product URL is identical tick to tick (offsets are relative), so
    // without the buster the loop silently stops advancing.
    expect(iemTileUrl(5)).not.toContain('?');
    expect(iemTileUrl(5, 42)).toContain('?_=42');
    expect(iemTileUrl(5, 42)).toContain('{z}/{x}/{y}.png');
  });
});

describe('RainViewer frame adaptation', () => {
  const index = {
    host: 'https://tc.example',
    radar: {
      past: [{ time: NOW / 1000 - 600, path: '/v2/radar/a' }, { time: NOW / 1000, path: '/v2/radar/b' }],
      nowcast: [{ time: NOW / 1000 + 600, path: '/v2/radar/c' }],
    },
  };

  it('marks times OBSERVED — RainViewer publishes real per-frame stamps', () => {
    const f = buildRainviewerFrames(index);
    expect(f).toHaveLength(3);
    expect(f.every((x) => x.timeBasis === 'observed')).toBe(true);
    expect(f[1].time).toBe(NOW); // seconds → ms
  });

  it('keeps nowcast frames distinguishable from observed past frames', () => {
    const f = buildRainviewerFrames(index);
    expect(f.filter((x) => x.kind === 'nowcast')).toHaveLength(1);
  });

  it('returns nothing when the index is empty or malformed', () => {
    // The live index currently publishes zero nowcast frames, and the old panel
    // advertised "past + nowcast" regardless. Absent data must yield absence.
    expect(buildRainviewerFrames(null)).toEqual([]);
    expect(buildRainviewerFrames({})).toEqual([]);
    expect(buildRainviewerFrames({ host: 'h', radar: { past: [], nowcast: [] } })).toEqual([]);
  });
});

describe('evaluateStaleness — network-level age', () => {
  it('passes a fresh frame', () => {
    const v = evaluateStaleness({ newestTime: NOW - 4 * 60_000, now: NOW });
    expect(v.level).toBe('fresh');
    expect(Math.round(v.ageMin)).toBe(4);
  });

  it('flags a frame past the threshold and says how old', () => {
    const v = evaluateStaleness({ newestTime: NOW - 40 * 60_000, now: NOW });
    expect(v.level).toBe('stale');
    expect(v.message).toMatch(/40 min old/);
  });

  it('treats the threshold as exclusive at the boundary', () => {
    expect(evaluateStaleness({ newestTime: NOW - STALE_THRESHOLD_MIN * 60_000, now: NOW }).level)
      .toBe('fresh');
    expect(evaluateStaleness({ newestTime: NOW - (STALE_THRESHOLD_MIN + 1) * 60_000, now: NOW }).level)
      .toBe('stale');
  });

  it('reports unknown rather than inventing an age when there is no frame', () => {
    expect(evaluateStaleness({ newestTime: null, now: NOW }).level).toBe('unknown');
  });

  it('calls a future frame clock skew, not extra-fresh', () => {
    // A negative age must never read as the freshest possible data.
    const v = evaluateStaleness({ newestTime: NOW + 10 * 60_000, now: NOW });
    expect(v.level).toBe('unknown');
    expect(v.message).toMatch(/clock/i);
  });
});

describe('classifyFreshness — the IEM self-test', () => {
  it('reports live when the picture moved across the window', () => {
    expect(classifyFreshness(['a1', 'b2', 'c3'], ['a1', 'b2', 'zz']).level).toBe('live');
  });

  it('reports FROZEN when content is present but identical across 55 minutes', () => {
    // Distinct tiles → there IS echo in the sample; unchanged → cache is stuck.
    const hashes = ['a1', 'b2', 'c3'];
    const v = classifyFreshness(hashes, [...hashes]);
    expect(v.level).toBe('frozen');
    expect(v.reason).toMatch(/stuck/i);
  });

  it('reports UNVERIFIABLE on a quiet sky instead of crying stale', () => {
    // Every sampled tile identical to every other → an all-empty sample. A clear
    // afternoon is indistinguishable from a frozen cache by this test, and a
    // false outage warning teaches the reader to ignore real ones.
    const empty = ['ee', 'ee', 'ee', 'ee'];
    const v = classifyFreshness(empty, [...empty]);
    expect(v.level).toBe('unverifiable');
    expect(v.reason).toMatch(/no echo/i);
  });

  it('separates the two identical cases purely on sample diversity', () => {
    // Same "nothing changed" input; only whether the tiles differ from each
    // other decides frozen vs unverifiable. This is the distinction that keeps
    // the warning trustworthy.
    expect(classifyFreshness(['x', 'x'], ['x', 'x']).level).toBe('unverifiable');
    expect(classifyFreshness(['x', 'y'], ['x', 'y']).level).toBe('frozen');
  });

  it('reports unknown on an unusable or mismatched sample', () => {
    expect(classifyFreshness([], []).level).toBe('unknown');
    expect(classifyFreshness(['a'], ['a', 'b']).level).toBe('unknown');
    expect(classifyFreshness(null, null).level).toBe('unknown');
  });
});

describe('reconcileFrameIndex — refresh must not move the reader', () => {
  const frames = (n) => Array.from({ length: n }, (_, i) => ({ i }));

  it('keeps a viewer parked on the live frame on the live frame', () => {
    expect(reconcileFrameIndex(frames(12), frames(12), 11)).toBe(11);
  });

  it('preserves position measured from NOW, not from the list start', () => {
    // These are rolling windows: index 0 is a different moment after every
    // refresh, but "3 frames back from now" is the same moment the reader chose.
    expect(reconcileFrameIndex(frames(12), frames(12), 8)).toBe(8);
    expect(reconcileFrameIndex(frames(12), frames(13), 8)).toBe(9); // 3 back from newest
  });

  it('lands on the newest frame on first load', () => {
    expect(reconcileFrameIndex([], frames(12), 0)).toBe(11);
  });

  it('clamps rather than throwing when the list shrinks under the index', () => {
    expect(reconcileFrameIndex(frames(12), frames(3), 0)).toBe(0);
    expect(reconcileFrameIndex(frames(12), frames(3), 11)).toBe(2);
  });

  it('returns 0 when there is nothing to show', () => {
    expect(reconcileFrameIndex(frames(12), [], 5)).toBe(0);
  });
});

describe('buildLegend — rendered from palette.js, never redeclared', () => {
  it('uses the palette stops verbatim', () => {
    // palette.js is the single source of truth for these hexes; a copy here
    // would be the drift the palette exists to prevent.
    const legend = buildLegend();
    expect(legend).toHaveLength(REFLECTIVITY_STOPS.length);
    expect(legend.map((b) => b.fill)).toEqual(REFLECTIVITY_STOPS.map((s) => s.fill));
    expect(legend.map((b) => b.dbz)).toEqual(REFLECTIVITY_STOPS.map((s) => s.dbz));
  });

  it('marks the top band open-ended', () => {
    const legend = buildLegend();
    expect(legend[legend.length - 1].label).toBe('65+');
    expect(legend[0].label).toBe('20');
  });

  it('states its scope, because the tiles paint outside it', () => {
    // The scale covers 20–65 dBZ; the tiles also render lighter echoes below 20,
    // and their PNGs are anti-aliased between stops. The note is what keeps this
    // a key rather than a false promise of byte-exactness.
    expect(LEGEND_NOTE).toMatch(/20\+/);
    expect(LEGEND_NOTE).toMatch(/lighter/i);
  });

  it('is driven by its argument, so the palette stays the only source', () => {
    const fake = [{ dbz: 5, fill: '#111111' }, { dbz: 10, fill: '#222222' }];
    expect(buildLegend(fake).map((b) => b.label)).toEqual(['5', '10+']);
  });
});
