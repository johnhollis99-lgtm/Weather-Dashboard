import Panel, { ResourceState } from './Panel.jsx';

// Extended multi-day NWS forecast periods with icons.
export default function ExtendedForecast({ forecast }) {
  const periods = (forecast?.data || []).slice(0, 14);
  return (
    <Panel title="Extended Forecast" sub="NWS multi-day">
      <ResourceState resource={forecast}>
        <div className="ext-grid">
          {periods.map((p) => (
            <div className="ext-card" key={p.number}>
              {p.icon && <img src={p.icon} alt="" />}
              <div className="ext-name">{p.name}</div>
              <div className="ext-temp">
                {p.temperature}°{p.temperatureUnit}
              </div>
              <div className="ext-short">{p.shortForecast}</div>
            </div>
          ))}
        </div>
      </ResourceState>
    </Panel>
  );
}
