import Panel, { ResourceState } from './Panel.jsx';
import { localTime } from '../lib/units.js';

// Next 24h temperature + precip probability (NWS forecastHourly).
export default function HourlyStrip({ hourly }) {
  const periods = (hourly?.data || []).slice(0, 24);
  const temps = periods.map((p) => p.temperature);
  const min = Math.min(...temps);
  const max = Math.max(...temps);

  return (
    <Panel title="Next 24 Hours" sub="temperature · precip probability">
      <ResourceState resource={hourly}>
        <div className="hourly">
          {periods.map((p) => {
            const pop = p.probabilityOfPrecipitation?.value ?? 0;
            const frac = max > min ? (p.temperature - min) / (max - min) : 0.5;
            return (
              <div className="hour" key={p.number}>
                <div className="h-time">{localTime(p.startTime, { hour: 'numeric' })}</div>
                <div className="h-temp">{p.temperature}°</div>
                <div className="h-pop">{pop}%</div>
                <div className="h-bar" style={{ width: `${20 + frac * 80}%`, marginInline: 'auto' }} />
              </div>
            );
          })}
        </div>
      </ResourceState>
    </Panel>
  );
}
