import { useId } from 'react';

// A small trend line for a stat card — "the pulse" under the number.
//
// Deliberately monochrome-subtle by default: the semantic ramps belong to the
// data channels (reflectivity, AQI, alert severity), and a sparkline competing
// with them would dilute the signal. Pass `tint` only where a semantic ramp
// genuinely applies (e.g. the temperature readout).
//
// Fixed viewBox + fixed CSS height means the card never reflows when values
// update on the 5-minute refresh — the path changes, the geometry does not.
export default function Sparkline({
  values,
  nowIndex = null,
  label,
  tint = null,
  height = 24,
  className = '',
}) {
  const id = useId();
  const clean = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length < 3) return null;

  const W = 100;
  const H = 28;
  const pad = 2;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  // A flat series must not divide by zero or slam against an edge.
  const span = max - min || 1;
  const x = (i) => (i / (clean.length - 1)) * W;
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);

  const line = clean.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const stroke = tint || 'var(--spark-ink)';

  return (
    <svg
      className={`spark-line ${className}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.30" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {nowIndex != null && nowIndex >= 0 && nowIndex < clean.length && (
        <circle cx={x(nowIndex)} cy={y(clean[nowIndex])} r="2" fill={stroke} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
