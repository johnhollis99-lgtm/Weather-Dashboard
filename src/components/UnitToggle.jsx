import { useUnits } from '../lib/unitsContext.jsx';

// Compact imperial/metric switch for the header corner. One control flips the
// whole dashboard's display units (°F·ft ↔ °C·m); the choice persists. Physics
// is unaffected — this only changes formatting.
export default function UnitToggle() {
  const { system, setSystem } = useUnits();
  return (
    <div className="unit-toggle" role="group" aria-label="Display units">
      <button
        type="button"
        className={system === 'imperial' ? 'active' : ''}
        aria-pressed={system === 'imperial'}
        onClick={() => setSystem('imperial')}
        title="Imperial — °F, ft, in, kt"
      >
        °F · ft
      </button>
      <button
        type="button"
        className={system === 'metric' ? 'active' : ''}
        aria-pressed={system === 'metric'}
        onClick={() => setSystem('metric')}
        title="Metric (SI) — °C, m, mm, m/s"
      >
        °C · m
      </button>
    </div>
  );
}
