import { useEffect, useRef, useState } from 'react';
import { displayParts, kmhToMs, windDir } from '../lib/units.js';
import { GUST_HATCH_KT } from './ConditionStrip.jsx';

// A compact compass dial for the observed wind.
//
// Circular data gets a dial — direction is angular, and reading "254°" as a
// number is strictly worse than seeing where the needle points. This AUGMENTS
// the readout: the numeric speed, gust and cardinal direction all remain as
// text beside it, so nothing here is available only as a graphic.
//
// Rules it enforces:
//   • Below CALM_MPH the needle is hidden and the dial reads CALM — a direction
//     reported for a 1 mph drift is fake precision.
//   • The gust marker only takes the amber threshold color once gusts exceed
//     GUST_HATCH_KT — the SAME threshold the condition strip hatches at, so one
//     number means one thing across the whole dashboard.
//   • Needle motion eases briefly on refresh, and not at all under
//     prefers-reduced-motion.
const CALM_MPH = 3;
const SIZE = 108;
const C = SIZE / 2;
const R = 42;

export default function WindDial({ speedKmh, dirDeg, gustKmh, system }) {
  const reduced = usePrefersReducedMotion();
  const speedMph = speedKmh == null ? null : speedKmh * 0.621371;
  const calm = speedMph == null || speedMph < CALM_MPH;

  // A "gust" at or below the sustained wind is not a gust — some stations
  // publish a windGust field that is stale or simply equal to the mean. Showing
  // it produced readouts like "SSW 9 mph, gusting 2 mph". Only a value that
  // genuinely exceeds the sustained wind is reported, and never while the dial
  // reads CALM: "calm, gusting 2 mph" is a contradiction, and a 2 mph gust is
  // measurement noise rather than weather.
  const hasGust = !calm && gustKmh != null && speedKmh != null && gustKmh > speedKmh;
  const gustKt = hasGust ? gustKmh * 0.539957 : null;
  const gusty = gustKt != null && gustKt >= GUST_HATCH_KT;

  const spd = displayParts('windSurface', kmhToMs(speedKmh), system);
  const gst = displayParts('windSurface', kmhToMs(gustKmh), system);

  // Meteorological convention: direction is where the wind comes FROM, and the
  // needle points from that bearing toward the centre.
  const needle = dirDeg == null ? null : dirDeg;

  const label = calm
    ? 'Wind calm'
    : `Wind from ${windDir(dirDeg)} at ${spd.text}${hasGust ? `, gusting ${gst.text}` : ''}`;

  return (
    <div className="wind-dial-wrap">
      <svg
        className={`wind-dial${reduced ? ' is-static' : ''}`}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <circle cx={C} cy={C} r={R} className="wd-ring" />
        {/* Cardinal + intercardinal ticks */}
        {Array.from({ length: 16 }, (_, i) => {
          const a = ((i * 22.5 - 90) * Math.PI) / 180;
          const major = i % 4 === 0;
          const r1 = R - (major ? 8 : 4);
          return (
            <line
              key={i}
              x1={C + Math.cos(a) * r1}
              y1={C + Math.sin(a) * r1}
              x2={C + Math.cos(a) * R}
              y2={C + Math.sin(a) * R}
              className={major ? 'wd-tick-major' : 'wd-tick'}
            />
          );
        })}
        {['N', 'E', 'S', 'W'].map((d, i) => {
          const a = ((i * 90 - 90) * Math.PI) / 180;
          return (
            <text
              key={d}
              x={C + Math.cos(a) * (R + 9)}
              y={C + Math.sin(a) * (R + 9) + 3.5}
              className="wd-card"
              textAnchor="middle"
            >
              {d}
            </text>
          );
        })}

        {/* Gust arc: a secondary marker on the same dial, not a second gauge. */}
        {!calm && hasGust && needle != null && (
          <line
            x1={C + Math.cos(((needle - 90) * Math.PI) / 180) * (R - 3)}
            y1={C + Math.sin(((needle - 90) * Math.PI) / 180) * (R - 3)}
            x2={C + Math.cos(((needle - 90) * Math.PI) / 180) * (R + 3)}
            y2={C + Math.sin(((needle - 90) * Math.PI) / 180) * (R + 3)}
            className={`wd-gust${gusty ? ' is-strong' : ''}`}
          />
        )}

        {!calm && needle != null && (
          <g className="wd-needle-group" style={{ transform: `rotate(${needle}deg)`, transformOrigin: `${C}px ${C}px` }}>
            {/* Points from the source bearing in toward the centre. */}
            <line x1={C} y1={C - R + 6} x2={C} y2={C - 19} className="wd-needle" />
            <polygon points={`${C},${C - 17} ${C - 4},${C - 25} ${C + 4},${C - 25}`} className="wd-needle-head" />
          </g>
        )}

        {calm ? (
          <text x={C} y={C + 4} className="wd-calm" textAnchor="middle">
            CALM
          </text>
        ) : (
          <>
            {/* Hub plate: keeps the numerals off the needle so neither is
                obscured when the needle points through the centre. */}
            <circle cx={C} cy={C} r={17} className="wd-hub" />
            <text x={C} y={C + 1} className="wd-speed" textAnchor="middle">
              {spd.num}
            </text>
            <text x={C} y={C + 11} className="wd-speed-unit" textAnchor="middle">
              {spd.unit}
            </text>
          </>
        )}
      </svg>

      {/* Numbers stay as text: scannable, selectable, screen-reader friendly. */}
      <div className="wind-dial-read">
        <div className="wd-line">
          <span className="wd-k">Wind</span>
          <span className="wd-v">{calm ? 'Calm' : `${windDir(dirDeg)} ${spd.text}`}</span>
        </div>
        {hasGust && (
          <div className="wd-line">
            <span className="wd-k">Gust</span>
            <span className={`wd-v${gusty ? ' is-strong' : ''}`}>G {gst.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Live media-query hook — respects a change of preference without a reload.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  const ref = useRef(null);
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    ref.current = mq;
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export { CALM_MPH };
