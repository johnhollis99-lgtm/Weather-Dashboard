import { describe, expect, it } from 'vitest';
import {
  DECODED_BUDGET_BYTES,
  DURATION_PRESETS,
  FRAME_COUNT,
  FULL_DISK,
  GOES_VIEWS,
  LOAD_CONCURRENCY,
  LOAD_QUORUM,
  MAX_FRAMES,
  alignToSlot,
  buildGoesFrames,
  crossesUTCDay,
  dayOfYearUTC,
  decodedBytes,
  defaultDurationH,
  describeLoop,
  formatStampUTC,
  frameIntervalMs,
  frameLoadOrder,
  gapIsMisleading,
  goesFrameUrl,
  missingTolerance,
  planLoop,
  playbackQuorum,
  summarizeGaps,
  terminatorCrossings,
  goesLatestUrl,
  goesStamp,
  parseGoesStamp,
  pruneFrameStatus,
  staleThresholdMin,
  summarizeFrameLoad,
} from './goes.js';

// The satellite loop's addressing scheme. Every constant here was read off the
// live NESDIS CDN rather than inferred — the cadences in particular are NOT
// uniform across views, and a single 5-minute rule (the obvious guess) yields
// nothing but 404s for wus and full disk.

const NOW = Date.parse('2026-08-12T04:12:04Z'); // day-of-year 224

describe('day-of-year', () => {
  it('is 1-based and matches the stamps the CDN publishes', () => {
    // Cross-checked against a real filename observed on the CDN:
    // 20262240211_GOES18-ABI-psw-GEOCOLOR-600x600.jpg → 2026, day 224, 02:11Z.
    expect(dayOfYearUTC(Date.parse('2026-08-12T02:11:00Z'))).toBe(224);
    expect(dayOfYearUTC(Date.parse('2026-01-01T00:00:00Z'))).toBe(1);
    expect(dayOfYearUTC(Date.parse('2026-12-31T23:59:00Z'))).toBe(365);
  });

  it('accounts for the leap day', () => {
    expect(dayOfYearUTC(Date.parse('2024-12-31T00:00:00Z'))).toBe(366);
    expect(dayOfYearUTC(Date.parse('2024-03-01T00:00:00Z'))).toBe(61); // 60 in a common year
  });

  it('reads the UTC date, not the host timezone', () => {
    // 23:30 UTC is already the next day-of-year even where the host clock says
    // otherwise. Getting this wrong shifts every frame URL by a whole day.
    expect(dayOfYearUTC(Date.parse('2026-08-12T23:30:00Z'))).toBe(224);
    expect(dayOfYearUTC(Date.parse('2026-08-13T00:30:00Z'))).toBe(225);
  });
});

describe('stamps', () => {
  it('formats YYYYDDDHHMM zero-padded', () => {
    expect(goesStamp(Date.parse('2026-08-12T02:11:00Z'))).toBe('20262240211');
    expect(goesStamp(Date.parse('2026-01-01T00:05:00Z'))).toBe('20260010005');
  });

  it('round-trips through parseGoesStamp', () => {
    const t = Date.parse('2026-08-12T04:10:00Z');
    expect(parseGoesStamp(goesStamp(t))).toBe(t);
  });

  it('returns null for anything that is not a stamp', () => {
    expect(parseGoesStamp('600x600')).toBeNull();
    expect(parseGoesStamp('')).toBeNull();
    expect(parseGoesStamp(undefined)).toBeNull();
  });
});

describe('slot alignment', () => {
  it('lands on the sector phase (:01, :06, :11 …)', () => {
    const at = (iso) => new Date(alignToSlot(Date.parse(iso), 5, 1)).toISOString();
    expect(at('2026-08-12T04:12:04Z')).toBe('2026-08-12T04:11:00.000Z');
    expect(at('2026-08-12T04:11:00Z')).toBe('2026-08-12T04:11:00.000Z'); // exact slot holds
    expect(at('2026-08-12T04:15:59Z')).toBe('2026-08-12T04:11:00.000Z');
    expect(at('2026-08-12T04:16:00Z')).toBe('2026-08-12T04:16:00.000Z');
  });

  it('lands on the ten-minute phase for wus and full disk', () => {
    const at = (iso) => new Date(alignToSlot(Date.parse(iso), 10, 0)).toISOString();
    expect(at('2026-08-12T04:12:04Z')).toBe('2026-08-12T04:10:00.000Z');
    expect(at('2026-08-12T04:09:59Z')).toBe('2026-08-12T04:00:00.000Z');
  });

  it('rolls back across the hour and the day when the phase underflows', () => {
    // 00:00 against a :01 phase is the previous hour's :56 — the negative-minute
    // underflow into Date.UTC is load-bearing, not an accident.
    expect(new Date(alignToSlot(Date.parse('2026-08-12T00:00:30Z'), 5, 1)).toISOString())
      .toBe('2026-08-11T23:56:00.000Z');
  });
});

describe('frame construction', () => {
  it('returns FRAME_COUNT frames oldest first, one cadence apart', () => {
    const frames = buildGoesFrames({ now: NOW, view: 'psw', band: 'GEOCOLOR' });
    expect(frames).toHaveLength(FRAME_COUNT);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i].time - frames[i - 1].time).toBe(5 * 60_000);
    }
    expect(frames.at(-1).time).toBeGreaterThan(frames[0].time);
  });

  it('includes the newest slot even though the CDN publishes behind it', () => {
    // Deliberate: the panel prunes a 404 for free, whereas back-dating the
    // window by a fixed guess would discard real frames whenever the CDN ran
    // ahead of that guess.
    const frames = buildGoesFrames({ now: NOW, view: 'psw', band: 'GEOCOLOR' });
    expect(frames.at(-1).stamp).toBe('20262240411');
  });

  it('spans an hour of sector scans and two hours of full disk', () => {
    const span = (view) => {
      const f = buildGoesFrames({ now: NOW, view, band: 'GEOCOLOR' });
      return (f.at(-1).time - f[0].time) / 60_000;
    };
    expect(span('psw')).toBe(55); // 11 gaps × 5 min
    expect(span(FULL_DISK)).toBe(110); // 11 gaps × 10 min
  });

  it('marks frame times OBSERVED, unlike the IEM radar frames', () => {
    // The stamp is part of the URL we request, so a frame that loads has proven
    // its own valid time. radar.js cannot say this and marks IEM 'derived'.
    const frames = buildGoesFrames({ now: NOW, view: 'psw', band: '13' });
    expect(frames.every((f) => f.timeBasis === 'observed')).toBe(true);
    expect(frames.every((f) => parseGoesStamp(f.stamp) === f.time)).toBe(true);
  });

  it('returns nothing for a view the CDN does not publish', () => {
    expect(buildGoesFrames({ now: NOW, view: 'nope', band: 'GEOCOLOR' })).toEqual([]);
  });
});

describe('buildGoesFrames — additive stepMin and size', () => {
  // The whole point of the two parameters being optional: a call that omits them
  // must build the window this function built before they existed, object for
  // object. If this drifts, the duration control has silently changed the
  // default loop.
  it('is byte-identical to the previous signature when both are omitted', () => {
    for (const view of Object.keys(GOES_VIEWS)) {
      for (const band of ['GEOCOLOR', '08', '13']) {
        const cfg = GOES_VIEWS[view];
        expect(buildGoesFrames({ now: NOW, view, band })).toEqual(
          buildGoesFrames({ now: NOW, view, band, stepMin: cfg.cadenceMin, size: cfg.size }),
        );
      }
    }
  });

  it('still produces exactly the frames the panel shipped before the control', () => {
    // Pinned literally, not by formula, so a change to planLoop cannot quietly
    // redefine what "unchanged" means.
    const frames = buildGoesFrames({ now: NOW, view: 'psw', band: 'GEOCOLOR' });
    expect(frames).toHaveLength(FRAME_COUNT);
    expect(frames[0].stamp).toBe('20262240316');
    expect(frames.at(-1).stamp).toBe('20262240411');
    expect(frames.at(-1).url).toBe(
      'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/psw/GEOCOLOR/' +
        '20262240411_GOES18-ABI-psw-GEOCOLOR-600x600.jpg',
    );
  });

  it('anchors the newest frame to the CADENCE slot, never to the step', () => {
    // Aligning to an hourly step would date the leading frame up to an hour back
    // even with a four-minute-old scan on the CDN — discarding the freshness the
    // window is deliberately built to keep.
    const native = buildGoesFrames({ now: NOW, view: 'psw', band: '08' });
    const hourly = buildGoesFrames({ now: NOW, view: 'psw', band: '08', stepMin: 60, count: 6 });
    expect(hourly.at(-1).stamp).toBe(native.at(-1).stamp);
    expect(hourly.at(-1).time).toBe(native.at(-1).time);
  });

  it('lands every decimated frame on a real scan boundary', () => {
    // Steps are whole multiples of the cadence, so `newest - i × step` stays on
    // the view's published phase. This is the invariant the 404-pruning design
    // would otherwise have to absorb as a wall of missing frames.
    for (const view of Object.keys(GOES_VIEWS)) {
      const cfg = GOES_VIEWS[view];
      for (const h of DURATION_PRESETS) {
        const p = planLoop({ view, durationH: h });
        for (const f of buildGoesFrames({ now: NOW, view, band: '08', ...p })) {
          const min = new Date(f.time).getUTCMinutes();
          expect((min - cfg.phaseMin + 60) % cfg.cadenceMin).toBe(0);
          expect(parseGoesStamp(f.stamp)).toBe(f.time);
        }
      }
    }
  });

  it('puts the requested size in the url and steps at the requested interval', () => {
    const f = buildGoesFrames({
      now: NOW,
      view: 'psw',
      band: 'GEOCOLOR',
      count: 3,
      stepMin: 60,
      size: '300x300',
    });
    expect(f.map((x) => x.stamp)).toEqual(['20262240211', '20262240311', '20262240411']);
    expect(f[0].url).toContain('300x300.jpg');
    expect((f[1].time - f[0].time) / 60_000).toBe(60);
  });
});

describe('loop planning', () => {
  // The §1 ladder and §2 tiers, pinned as tables. These are the numbers the
  // design was signed off on; a rule change that moves any cell should have to
  // say so here.
  const PLAN_5MIN = [
    // durationH, stepMin, count, size, decoded MB
    [1, 5, 12, '600x600'],
    [3, 5, 36, '600x600'],
    [6, 5, 72, '300x300'],
    [12, 10, 72, '300x300'],
    [24, 15, 96, '300x300'],
    [48, 30, 96, '300x300'],
    [72, 60, 72, '300x300'],
  ];
  const PLAN_10MIN = [
    [1, 10, 6, '500x500'],
    [3, 10, 18, '500x500'],
    [6, 10, 36, '500x500'],
    [12, 10, 72, '250x250'],
    [24, 20, 72, '250x250'],
    [48, 30, 96, '250x250'],
    [72, 60, 72, '250x250'],
  ];
  const PLAN_FD = [
    [1, 10, 6, '678x678'],
    [3, 10, 18, '678x678'],
    // 36 × 678² × 4 = 66.2 MB, inside the 70 MB budget by 5% — the full disk
    // keeps its resolution at six hours, which is why the budget is 70 and not 64.
    [6, 10, 36, '678x678'],
    [12, 10, 72, '339x339'],
    [24, 20, 72, '339x339'],
    [48, 30, 96, '339x339'],
    [72, 60, 72, '339x339'],
  ];

  it.each([
    ['psw', PLAN_5MIN],
    ['pnw', PLAN_5MIN],
    ['wus', PLAN_10MIN],
    [FULL_DISK, PLAN_FD],
  ])('resolves every rung for %s', (view, table) => {
    for (const [durationH, stepMin, count, size] of table) {
      expect(planLoop({ view, durationH })).toEqual({
        durationH,
        stepMin,
        count,
        size,
        spanMin: (count - 1) * stepMin,
      });
    }
  });

  it('never exceeds the frame ceiling or the decode budget', () => {
    for (const view of Object.keys(GOES_VIEWS)) {
      for (const durationH of DURATION_PRESETS) {
        const p = planLoop({ view, durationH });
        expect(p.count).toBeLessThanOrEqual(MAX_FRAMES);
        expect(decodedBytes(p.size, p.count)).toBeLessThanOrEqual(DECODED_BUDGET_BYTES);
      }
    }
  });

  it('only ever picks a step that is a whole multiple of the view cadence', () => {
    // The invariant every decimated frame URL depends on.
    for (const view of Object.keys(GOES_VIEWS)) {
      for (const durationH of DURATION_PRESETS) {
        expect(planLoop({ view, durationH }).stepMin % GOES_VIEWS[view].cadenceMin).toBe(0);
      }
    }
  });

  it('keeps native cadence for as long as the frame ceiling allows', () => {
    // Short spans should not be decimated just because long ones must be.
    expect(planLoop({ view: 'psw', durationH: 6 }).stepMin).toBe(5);
    expect(planLoop({ view: 'wus', durationH: 12 }).stepMin).toBe(10);
  });

  it('returns nothing for a view the CDN does not publish', () => {
    expect(planLoop({ view: 'nope', durationH: 24 })).toBeNull();
  });

  it('opens each view on the first rung at least as dense as the old loop', () => {
    // One hour is twelve frames on a 5-minute sector but only six on the
    // 10-minute views, so a flat default would open the full disk on half a loop.
    expect(defaultDurationH('psw')).toBe(1);
    expect(defaultDurationH('pnw')).toBe(1);
    expect(defaultDurationH('wus')).toBe(3);
    expect(defaultDurationH(FULL_DISK)).toBe(3);
    for (const view of Object.keys(GOES_VIEWS)) {
      expect(planLoop({ view, durationH: defaultDurationH(view) }).count).toBeGreaterThanOrEqual(
        FRAME_COUNT,
      );
    }
  });

  it('opens the 5-minute sectors on exactly the window they had before', () => {
    // The default rung must reproduce the shipped loop, not merely resemble it.
    const p = planLoop({ view: 'psw', durationH: defaultDurationH('psw') });
    expect(p).toMatchObject({ stepMin: GOES_VIEWS.psw.cadenceMin, count: FRAME_COUNT });
    expect(buildGoesFrames({ now: NOW, view: 'psw', band: '08', ...p })).toEqual(
      buildGoesFrames({ now: NOW, view: 'psw', band: '08' }),
    );
  });
});

describe('urls', () => {
  it('builds the sector path with the lowercase sector id in both places', () => {
    expect(goesFrameUrl({ view: 'psw', band: 'GEOCOLOR', size: '600x600', stamp: '20262240211' }))
      .toBe(
        'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/psw/GEOCOLOR/' +
          '20262240211_GOES18-ABI-psw-GEOCOLOR-600x600.jpg',
      );
  });

  it('builds the full-disk path under FD/, uppercase in both places', () => {
    expect(goesFrameUrl({ view: FULL_DISK, band: '13', size: '678x678', stamp: '20262240210' }))
      .toBe(
        'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/13/' +
          '20262240210_GOES18-ABI-FD-13-678x678.jpg',
      );
  });

  it('exposes the unstamped newest-scan alias', () => {
    expect(goesLatestUrl({ view: 'wus', band: 'AirMass', size: '500x500' }))
      .toBe('https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/wus/AirMass/500x500.jpg');
  });

  it('pairs every view with a size that view actually publishes', () => {
    // psw/pnw publish 300/600/1200/2400; wus publishes 250/500/1000/2000/4000;
    // FD publishes 339/678/1808/…. Cross-wiring these is a silent 404.
    expect(GOES_VIEWS.psw.size).toBe('600x600');
    expect(GOES_VIEWS.pnw.size).toBe('600x600');
    expect(GOES_VIEWS.wus.size).toBe('500x500');
    expect(GOES_VIEWS[FULL_DISK].size).toBe('678x678');
  });
});

describe('staleness threshold', () => {
  it('scales with the view cadence rather than being flat', () => {
    // A 12-minute-old full disk is ordinary; a 12-minute-old psw sector has
    // missed two scans.
    expect(staleThresholdMin('psw')).toBe(20);
    expect(staleThresholdMin(FULL_DISK)).toBe(30);
    expect(staleThresholdMin('wus')).toBe(30);
  });

  it('falls back to a sane number for an unknown view', () => {
    expect(staleThresholdMin('nope')).toBe(20);
  });
});

describe('staleness threshold — step relative', () => {
  // The threshold judges the newest frame against the interval the loop SAMPLES
  // at, which is the scan cadence only while the loop is native. These tests
  // exist to pin the default: the second argument was added for decimated loops
  // and must leave every existing one-argument call exactly where it was.
  it('defaults to the view cadence, so every current call is byte-identical', () => {
    for (const [view, cfg] of Object.entries(GOES_VIEWS)) {
      expect(staleThresholdMin(view)).toBe(cfg.cadenceMin * 2 + 10);
      expect(staleThresholdMin(view)).toBe(staleThresholdMin(view, cfg.cadenceMin));
    }
    // Belt and braces: the literal numbers the panel ships today.
    expect(staleThresholdMin('psw')).toBe(20);
    expect(staleThresholdMin('pnw')).toBe(20);
    expect(staleThresholdMin('wus')).toBe(30);
    expect(staleThresholdMin(FULL_DISK)).toBe(30);
  });

  it('follows the step once the loop is decimated below native cadence', () => {
    // The defect this replaces: an hourly-step psw loop has a newest frame up to
    // 60 minutes old by construction, and the cadence-derived 20-minute
    // threshold called that stale on every single render.
    expect(staleThresholdMin('psw', 60)).toBe(130);
    expect(staleThresholdMin('psw', 15)).toBe(40);
    expect(staleThresholdMin(FULL_DISK, 30)).toBe(70);
  });

  it('still falls back for an unknown view only when no step is given', () => {
    expect(staleThresholdMin('nope')).toBe(20);
    expect(staleThresholdMin('nope', 60)).toBe(130);
  });
});

describe('loop description', () => {
  // Reproduces `${span}-min loop at ${cadenceMin}-min scans`, the template this
  // replaced, for every window the panel can currently build.
  it('is verbatim identical to the caption the panel ships today', () => {
    for (const view of Object.keys(GOES_VIEWS)) {
      const f = buildGoesFrames({ now: NOW, view, band: 'GEOCOLOR' });
      const spanMin = (f.at(-1).time - f[0].time) / 60_000;
      const cad = GOES_VIEWS[view].cadenceMin;
      expect(describeLoop({ spanMin, stepMin: cad, cadenceMin: cad })).toBe(
        `${spanMin}-min loop at ${cad}-min scans`,
      );
    }
    expect(describeLoop({ spanMin: 55, stepMin: 5, cadenceMin: 5 })).toBe(
      '55-min loop at 5-min scans',
    );
    expect(describeLoop({ spanMin: 110, stepMin: 10, cadenceMin: 10 })).toBe(
      '110-min loop at 10-min scans',
    );
  });

  it('names the scan cadence only while the loop is running at it', () => {
    // Quoting "5-min scans" over hourly steps describes imagery that is not on
    // screen — the panel contradicting itself in its own footnote.
    expect(describeLoop({ spanMin: 4260, stepMin: 60, cadenceMin: 5 })).toBe(
      '71-h loop at 60-min steps',
    );
    expect(describeLoop({ spanMin: 1425, stepMin: 15, cadenceMin: 5 })).toBe(
      '23.8-h loop at 15-min steps',
    );
  });

  it('switches to hours only once minutes stop being legible', () => {
    expect(describeLoop({ spanMin: 119, stepMin: 5, cadenceMin: 5 })).toBe(
      '119-min loop at 5-min scans',
    );
    expect(describeLoop({ spanMin: 120, stepMin: 5, cadenceMin: 5 })).toBe(
      '2-h loop at 5-min scans',
    );
  });

  it('keeps one decimal for a span that is not a whole number of hours', () => {
    // 72 native psw frames span 355 minutes, not a round six hours.
    expect(describeLoop({ spanMin: 355, stepMin: 5, cadenceMin: 5 })).toBe(
      '5.9-h loop at 5-min scans',
    );
    expect(describeLoop({ spanMin: 720, stepMin: 10, cadenceMin: 10 })).toBe(
      '12-h loop at 10-min scans',
    );
  });
});

describe('load bookkeeping', () => {
  const frames = ['a', 'b', 'c'].map((url) => ({ url }));

  it('is unsettled while any candidate is still in flight', () => {
    expect(summarizeFrameLoad(frames, { a: 'ok' })).toMatchObject({ resolved: 1, settled: false });
  });

  it('settles once every candidate has ANSWERED, not once every one succeeded', () => {
    // The load-bearing case: the newest slot is routinely unpublished, so a
    // window that demanded all-success would never start playing at all.
    const s = summarizeFrameLoad(frames, { a: 'ok', b: 'ok', c: 'fail' });
    expect(s.settled).toBe(true);
    expect(s.usable.map((f) => f.url)).toEqual(['a', 'b']);
  });

  it('settles with nothing usable when the product is gone', () => {
    const s = summarizeFrameLoad(frames, { a: 'fail', b: 'fail', c: 'fail' });
    expect(s.settled).toBe(true);
    expect(s.usable).toEqual([]);
  });

  it('is never settled on an empty candidate list', () => {
    expect(summarizeFrameLoad([], {}).settled).toBe(false);
  });

  it('keeps usable frames in window order, oldest first', () => {
    const s = summarizeFrameLoad(frames, { a: 'ok', b: 'fail', c: 'ok' });
    expect(s.usable.map((f) => f.url)).toEqual(['a', 'c']);
  });
});

describe('progressive loading', () => {
  it('requests the newest frame first, then coarse to fine', () => {
    const order = frameLoadOrder(96);
    expect(order[0]).toBe(95); // newest — what the panel shows at rest
    // The next twelve are stride-8, spanning the entire window rather than
    // clustering at one end.
    expect(order.slice(1, 13)).toEqual([0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88]);
  });

  it('is a permutation — every frame is requested exactly once', () => {
    for (const n of [1, 2, 3, 6, 12, 36, 72, 96]) {
      const order = frameLoadOrder(n);
      expect(order).toHaveLength(n);
      expect(new Set(order).size).toBe(n);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
    expect(frameLoadOrder(0)).toEqual([]);
  });

  it('spreads its first frames across the window, unlike sequential order', () => {
    // The property that matters: at quorum the loop must span the whole window.
    // Sequential order would have covered only the oldest quarter of it.
    const n = 96;
    const first = frameLoadOrder(n).slice(0, LOAD_QUORUM);
    expect(Math.min(...first)).toBe(0);
    expect(Math.max(...first)).toBe(n - 1);
    const sorted = [...first].sort((a, b) => a - b);
    const widest = Math.max(...sorted.slice(1).map((v, i) => v - sorted[i]));
    expect(widest).toBeLessThanOrEqual(8);
  });

  it('holds exactly LOAD_CONCURRENCY requests open as frames resolve', () => {
    // The mount window the panel derives: resolved + concurrency, capped.
    const n = 96;
    for (const resolved of [0, 1, 30, 89, 90, 96]) {
      const mounted = Math.min(n, resolved + LOAD_CONCURRENCY);
      expect(mounted - resolved).toBe(Math.min(LOAD_CONCURRENCY, n - resolved));
    }
  });

  it('demands a quorum only from windows big enough to have one', () => {
    expect(playbackQuorum(6)).toBeNull();
    expect(playbackQuorum(12)).toBeNull();
    expect(playbackQuorum(24)).toBeNull(); // 24 of 24 is just `settled`
    expect(playbackQuorum(36)).toBe(24);
    expect(playbackQuorum(72)).toBe(24);
    expect(playbackQuorum(96)).toBe(24);
  });
});

describe('playback cadence', () => {
  it('holds the cycle at ten seconds across the whole fill', () => {
    // The failure this replaces: deriving from the TARGET count would hold every
    // frame for 104 ms, so the 24-frame quorum loop would cycle in 2.5 s and
    // visibly slow to 10 s as the rest landed.
    for (const usable of [24, 30, 36, 48, 60, 72, 84, 96]) {
      const cycle = usable * frameIntervalMs(usable);
      expect(cycle).toBeGreaterThan(9_800);
      expect(cycle).toBeLessThan(10_200);
    }
  });

  it('starts at a ten-second cycle the instant quorum is met', () => {
    // Why the quorum is a flat 24 and not a fraction: at 9 or 18 frames the
    // 450 ms ceiling binds and the cycle would start at 4.05 s or 8.10 s.
    expect(frameIntervalMs(LOAD_QUORUM)).toBe(417);
    expect(LOAD_QUORUM * frameIntervalMs(LOAD_QUORUM)).toBeCloseTo(10_008, -2);
    expect(frameIntervalMs(9)).toBe(450); // would have been 4.05 s
    expect(frameIntervalMs(18)).toBe(450); // would have been 8.10 s
  });

  it('leaves the short windows at the 450 ms this panel shipped with', () => {
    expect(frameIntervalMs(12)).toBe(450);
    expect(frameIntervalMs(6)).toBe(450);
  });

  it('applies the speed multiplier and never goes below the paint floor', () => {
    expect(frameIntervalMs(96, 1)).toBe(104);
    expect(frameIntervalMs(96, 2)).toBe(60); // floored, not 52
    expect(frameIntervalMs(96, 0.5)).toBe(208);
    expect(frameIntervalMs(12, 2)).toBe(225);
    expect(frameIntervalMs(12, 0.5)).toBe(900);
  });
});

describe('missing-frame tolerance', () => {
  it('reproduces the old flat constant for the window it was written for', () => {
    // EXPECTED_MISSING was 2, for a twelve-frame native sector window. Rounding
    // rather than ceiling the history term is what keeps it at exactly 2 instead
    // of quietly loosening the shipped default to 3.
    expect(missingTolerance({ count: 12, stepMin: 5 })).toBe(2);
  });

  it('shrinks its leading-edge allowance as the step grows', () => {
    // Two unpublished slots is plausible at 5-minute steps and impossible at 60:
    // only one slot can be newer than the CDN's ~10-minute publish lag.
    expect(missingTolerance({ count: 12, stepMin: 5 })).toBe(2);
    expect(missingTolerance({ count: 12, stepMin: 10 })).toBe(1);
    expect(missingTolerance({ count: 12, stepMin: 60 })).toBe(1);
  });

  it('evaluates to these values on the rungs the panel offers', () => {
    const at = (view, durationH) => {
      const p = planLoop({ view, durationH });
      return missingTolerance({ count: p.count, stepMin: p.stepMin });
    };
    expect(at('psw', 1)).toBe(2); // 12 frames, 5-min
    expect(at('psw', 3)).toBe(3); // 36 frames, 5-min
    expect(at('psw', 6)).toBe(4); // 72 frames, 5-min
    expect(at('psw', 12)).toBe(3); // 72 frames, 10-min
    expect(at('psw', 24)).toBe(4); // 96 frames, 15-min
    expect(at('psw', 48)).toBe(4); // 96 frames, 30-min
    expect(at('psw', 72)).toBe(3); // 72 frames, 60-min
    expect(at(FULL_DISK, 72)).toBe(3);
  });

  it('stays above the loss actually measured on the CDN', () => {
    // Trailing 72 h: 0.00% on band 08 everywhere, 1.39% worst case on GEOCOLOR.
    for (const view of Object.keys(GOES_VIEWS)) {
      for (const durationH of DURATION_PRESETS) {
        const p = planLoop({ view, durationH });
        const worstMeasured = Math.round(p.count * 0.0139);
        expect(missingTolerance(p)).toBeGreaterThanOrEqual(worstMeasured);
      }
    }
  });
});

describe('gap shape', () => {
  const win = (n, stepMin = 5) =>
    buildGoesFrames({ now: NOW, view: 'psw', band: '08', count: n, stepMin });
  const mark = (frames, failAt) =>
    Object.fromEntries(frames.map((f, i) => [f.url, failAt.includes(i) ? 'fail' : 'ok']));

  it('reports scattered singletons as a run of one', () => {
    // The psw/pnw pattern measured over 72 h: six isolated holes, no two adjacent.
    const frames = win(72);
    const g = summarizeGaps(frames, mark(frames, [4, 17, 33, 48, 55, 66]));
    expect(g.missing).toBe(6);
    expect(g.longestRun).toBe(1);
    expect(gapIsMisleading({ longestRun: g.longestRun, stepMin: 5 })).toBe(false);
  });

  it('reports a contiguous outage as one run, and where it starts', () => {
    // The wus/FD pattern: three adjacent slots gone at once.
    const frames = win(72, 10);
    const g = summarizeGaps(frames, mark(frames, [20, 21, 22]));
    expect(g.missing).toBe(3);
    expect(g.longestRun).toBe(3);
    expect(g.gapStartTime).toBe(frames[20].time);
    expect(gapIsMisleading({ longestRun: 3, stepMin: 10 })).toBe(true); // 30 min
  });

  it('separates the longest run from scattered frames elsewhere', () => {
    const frames = win(72);
    const g = summarizeGaps(frames, mark(frames, [3, 30, 31, 32, 33, 34, 35, 60]));
    expect(g.missing).toBe(8);
    expect(g.longestRun).toBe(6);
    expect(g.missing - g.longestRun).toBe(2);
  });

  it('judges a hole by the time it removes, not the frames', () => {
    // Three slots is 15 minutes natively and 3 hours at hourly steps. The same
    // run length is unremarkable in one window and a false jump in the other.
    expect(gapIsMisleading({ longestRun: 3, stepMin: 5 })).toBe(false); // 15 min
    expect(gapIsMisleading({ longestRun: 6, stepMin: 5 })).toBe(true); // 30 min
    expect(gapIsMisleading({ longestRun: 1, stepMin: 60 })).toBe(false); // one slot
    expect(gapIsMisleading({ longestRun: 2, stepMin: 60 })).toBe(true); // 2 h
    expect(gapIsMisleading({ longestRun: 0, stepMin: 5 })).toBe(false);
  });

  it('counts only frames that answered, never ones still in flight', () => {
    // Mid-fill, an unresolved frame is not a hole. Treating it as one would make
    // every window look broken while it loaded.
    const frames = win(12);
    expect(summarizeGaps(frames, {})).toMatchObject({ missing: 0, longestRun: 0 });
    expect(summarizeGaps(frames, { [frames[0].url]: 'ok' }).missing).toBe(0);
  });
});

describe('UTC stamps and terminator crossings', () => {
  it('is UTC, and dates itself only once the window outlives a day', () => {
    const t = Date.parse('2026-08-13T20:11:00Z');
    expect(formatStampUTC(t)).toBe('20:11Z');
    expect(formatStampUTC(t, { withDate: true })).toBe('13 Aug 20:11Z');
    expect(formatStampUTC(Date.parse('2026-08-03T04:05:00Z'), { withDate: true })).toBe(
      '3 Aug 04:05Z',
    );
  });

  it('detects a UTC midnight crossing, not a wall-clock one', () => {
    expect(crossesUTCDay(Date.parse('2026-08-13T01:00Z'), Date.parse('2026-08-13T23:00Z'))).toBe(
      false,
    );
    expect(crossesUTCDay(Date.parse('2026-08-13T23:55Z'), Date.parse('2026-08-14T00:05Z'))).toBe(
      true,
    );
    // Same day-of-month, different month — a naive getUTCDate() compare misses this.
    expect(crossesUTCDay(Date.parse('2026-08-13T00:00Z'), Date.parse('2026-09-13T00:00Z'))).toBe(
      true,
    );
  });

  it('counts a dusk and a dawn per day', () => {
    expect(terminatorCrossings(72)).toBe(6);
    expect(terminatorCrossings(48)).toBe(4);
    expect(terminatorCrossings(24)).toBe(2);
    expect(terminatorCrossings(12)).toBe(1);
    expect(terminatorCrossings(6)).toBe(0);
    expect(terminatorCrossings(1)).toBe(0);
  });
});

describe('status pruning', () => {
  it('keeps verdicts for frames still in the window across a refresh tick', () => {
    // The overlap is the point: eleven of twelve frames survive a tick, and
    // re-fetching them because the list object changed would defeat the whole
    // timestamped-URL design.
    const next = [{ url: 'b' }, { url: 'c' }, { url: 'd' }];
    expect(pruneFrameStatus(next, { a: 'ok', b: 'ok', c: 'fail' })).toEqual({
      b: 'ok',
      c: 'fail',
    });
  });

  it('drops everything when a band switch changes every url', () => {
    const next = [{ url: 'x' }, { url: 'y' }];
    expect(pruneFrameStatus(next, { a: 'ok', b: 'ok' })).toEqual({});
  });

  it('returns the SAME object when nothing was dropped, so React can skip a render', () => {
    const next = [{ url: 'a' }, { url: 'b' }];
    const status = { a: 'ok', b: 'ok' };
    expect(pruneFrameStatus(next, status)).toBe(status);
  });
});
