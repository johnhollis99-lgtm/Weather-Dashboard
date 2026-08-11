import Panel, { ResourceState } from './Panel.jsx';
import { nearestHourIndex } from '../lib/diagnostics.js';
import { fmt } from '../lib/units.js';
import { aqiBand, readableOn } from '../lib/palette.js';

// Category colors come from palette.js, which carries EPA/AirNow's OFFICIAL
// hexes. This panel previously used softened approximations (#4caf85 for Good,
// #e0b341 for Moderate, …) — pleasant, but they break the calibration every
// reader already has from AirNow maps. The official values are used exactly,
// and only ever as a FILL with an auto-picked label color, because several of
// them fail contrast as text on a dark ground.
const aqiCategory = aqiBand;

export default function AirQuality({ airQuality }) {
  const data = airQuality?.data;
  let body = null;
  if (data?.hourly?.time?.length) {
    const h = data.hourly;
    const i = nearestHourIndex(h.time, data.utc_offset_seconds);
    const aqi = h.us_aqi?.[i];
    const cat = aqiCategory(aqi);
    const trend = (h.us_aqi || []).slice(Math.max(0, i - 23), i + 1);
    const tmax = Math.max(...trend, 1);
    body = (
      <>
        <div className="aqi-big">
          <div className="aqi-dot" style={{ background: cat.fill, color: readableOn(cat.fill) }}>
            {aqi != null ? Math.round(aqi) : '—'}
          </div>
          <div>
            {/* Category as a filled swatch, not colored text: EPA's "Very
                Unhealthy" (#8F3F97) is 2.6:1 and "Hazardous" (#7E0023) is
                1.5:1 against this ground, so as text they would fail AA. */}
            <div className="aqi-cat-chip" style={{ background: cat.fill, color: readableOn(cat.fill) }}>
              {cat.label}
            </div>
            <div className="obs-note">US AQI · relevant for wildfire smoke</div>
          </div>
        </div>
        <div className="aqi-pollutants">
          <Pollutant k="PM2.5" v={fmt(h.pm2_5?.[i], 1)} u="µg/m³" />
          <Pollutant k="PM10" v={fmt(h.pm10?.[i], 1)} u="µg/m³" />
          <Pollutant k="Ozone" v={fmt(h.ozone?.[i], 0)} u="µg/m³" />
        </div>
        <div className="diag-section-title">24-hour AQI trend</div>
        <div className="spark" title="US AQI, last 24h">
          {trend.map((v, k) => (
            <div
              key={k}
              style={{ height: `${(v / tmax) * 100}%`, background: aqiCategory(v).fill }}
              title={`${Math.round(v)}`}
            />
          ))}
        </div>
      </>
    );
  }
  return (
    <Panel title="Air Quality" sub="Open-Meteo">
      <ResourceState resource={airQuality}>{body}</ResourceState>
    </Panel>
  );
}

function Pollutant({ k, v, u }) {
  return (
    <div className="cc-row">
      <span className="k">{k}</span>
      <span>{v} <span className="m-unit">{u}</span></span>
    </div>
  );
}
