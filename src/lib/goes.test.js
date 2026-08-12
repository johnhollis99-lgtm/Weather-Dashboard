import { describe, expect, it } from 'vitest';
import {
  FRAME_COUNT,
  FULL_DISK,
  GOES_VIEWS,
  alignToSlot,
  buildGoesFrames,
  dayOfYearUTC,
  goesFrameUrl,
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
