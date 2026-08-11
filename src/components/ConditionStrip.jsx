import { useMemo } from 'react';
import { nearestHourIndex } from '../lib/diagnostics.js';
import { precipFill, tempFill } from '../lib/palette.js';
import { displayParts, kmhToMs, wallHour } from '../lib/units.js';
import { useUnits } from '../lib/unitsContext.jsx';

// THE SIGNATURE ELEMENT — the meteogram vernacular compressed to one line.
//
// A thin ribbon under the header carrying the next 18 hours as a single
// color-encoded band:
//   • fill      = precipitation intensity in the NEXRAD reflectivity ramp
//   • underlay  = temperature, as a low-alpha tint of the temperature ramp
//   • hatching  = wind, where gusts exceed the advisory-relevant threshold
//   • ticks     = hour marks beneath, now-marker pinned at the left edge
//
// It is one glanceable line that answers "what is the day going to do", which
// is the question every other panel takes a card to answer.
const HOURS = 18;
const GUST_HATCH_KT = 25; // gusts at/above this get the wind hatching

export default function ConditionStrip({ gfs, compact = false }) {
  const { system } = useUnits();
  const data = gfs?.data;

  const cells = useMemo(() => {
    const h = data?.hourly;
    if (!h?.time?.length) return null;
    const i0 = nearestHourIndex(h.time, data.utc_offset_seconds);
    const out = [];
    for (let i = i0; i < Math.min(h.time.length, i0 + HOURS); i++) {
      const precipMm = h.precipitation?.[i] ?? 0;
      const tempC = h.temperature_2m?.[i] ?? null;
      const gustKmh = h.wind_gusts_10m?.[i] ?? null;
      const gustKt = gustKmh == null ? null : gustKmh * 0.539957;
      out.push({
        time: h.time[i],
        precipMm,
        tempC,
        gustKt,
        precip: precipFill(precipMm),
        temp: tempFill(tempC),
        windy: gustKt != null && gustKt >= GUST_HATCH_KT,
      });
    }
    return out.length ? out : null;
  }, [data]);

  if (!cells) {
    // Skeleton at the FINAL height, so the header never shifts when data lands.
    return (
      <div className="cstrip cstrip-empty" aria-hidden="true">
        <div className="cstrip-track" />
      </div>
    );
  }

  const tickEvery = compact ? 6 : 3;

  return (
    <section className="cstrip" aria-label="Next 18 hours at a glance">
      <div className="cstrip-track" role="img" aria-label={summaryLabel(cells, system)}>
        {cells.map((c, i) => (
          <div
            key={c.time}
            className={`cstrip-cell${c.windy ? ' is-windy' : ''}`}
            title={cellTitle(c, system)}
          >
            {/* Temperature underlay — a tint, never a flood, so it cannot
                drown the reflectivity channel painted over it. */}
            <span className="cstrip-temp" style={{ background: c.temp || 'transparent' }} />
            {c.precip && <span className="cstrip-precip" style={{ background: c.precip }} />}
            {i === 0 && <span className="cstrip-now" aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="cstrip-ticks" aria-hidden="true">
        {cells.map((c, i) => (
          <span key={c.time} className="cstrip-tick">
            {i === 0 ? 'now' : i % tickEvery === 0 ? wallHour(c.time).replace(' ', '') : ''}
          </span>
        ))}
      </div>
    </section>
  );
}

function cellTitle(c, system) {
  const t = c.tempC == null ? '—' : displayParts('temperature', c.tempC, system).text;
  const bits = [`${wallHour(c.time)} · ${t}`];
  if (c.precipMm > 0.05) bits.push(`${c.precipMm.toFixed(1)} mm/h`);
  if (c.gustKt != null && c.gustKt >= 1) {
    bits.push(`gusts ${displayParts('wind', c.gustKt / 1.94384, system).text}`);
  }
  return bits.join(' · ');
}

function summaryLabel(cells, system) {
  const temps = cells.map((c) => c.tempC).filter((v) => v != null);
  const wet = cells.filter((c) => c.precipMm > 0.05).length;
  const windy = cells.filter((c) => c.windy).length;
  if (!temps.length) return 'Next 18 hours';
  const lo = displayParts('temperature', Math.min(...temps), system).text;
  const hi = displayParts('temperature', Math.max(...temps), system).text;
  return (
    `Next 18 hours: ${lo} to ${hi}` +
    (wet ? `, precipitation in ${wet} of 18 hours` : ', no precipitation') +
    (windy ? `, gusty in ${windy} hours` : '')
  );
}

export { GUST_HATCH_KT };
