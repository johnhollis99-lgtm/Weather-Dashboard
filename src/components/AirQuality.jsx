import Panel, { ResourceState } from './Panel.jsx';
import { nearestHourIndex } from '../lib/diagnostics.js';
import { fmt } from '../lib/units.js';

function aqiCategory(aqi) {
  if (aqi == null) return { label: '—', color: '#5e6e7d' };
  if (aqi <= 50) return { label: 'Good', color: '#4caf85' };
  if (aqi <= 100) return { label: 'Moderate', color: '#e0b341' };
  if (aqi <= 150) return { label: 'Unhealthy (Sensitive)', color: '#f59e42' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#ef6b5a' };
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#a06cd5' };
  return { label: 'Hazardous', color: '#9b2c2c' };
}

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
          <div className="aqi-dot" style={{ background: cat.color }}>{aqi != null ? Math.round(aqi) : '—'}</div>
          <div>
            <div className="aqi-cat" style={{ color: cat.color }}>{cat.label}</div>
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
              style={{ height: `${(v / tmax) * 100}%`, background: aqiCategory(v).color }}
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
