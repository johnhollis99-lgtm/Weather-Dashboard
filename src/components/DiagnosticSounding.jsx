import { useId, useMemo, useState } from 'react';
import {
  analyzeSounding,
  temperatureFromTheta,
  dewpointFromVaporPressure,
  moistAdiabatPath,
  interpByPressure,
  EPS,
} from '../lib/soundingMath.js';
import { displayParts, cToF } from '../lib/units.js';

// Plain-language hover explanations for each part of the chart (native SVG/HTML
// <title>/title= tooltips — no JS, no overlap, work everywhere). Hover any
// curve, shaded region, marker, or readout card for a one-line explanation.
const TIP = {
  temp: 'Environmental temperature — the actual air temperature measured at each height. It leans up-and-right because the chart is "skewed".',
  dew: 'Environmental dewpoint (moisture). The closer this line sits to the temperature line, the more humid/saturated that layer is — touching = cloud.',
  parcel: 'Lifted-parcel path — the temperature a surface air bubble would have if forced to rise. Where it sits to the RIGHT of (warmer than) the temperature line, the air rises on its own.',
  cape: 'CAPE — the area where the lifted parcel is warmer than its surroundings, so it accelerates upward. This is the storm’s fuel; bigger area = stronger updrafts.',
  cin: 'CIN — the area where the parcel is cooler than its surroundings and resists rising. The "cap" that must be broken before storms can fire.',
  capband: 'Capping inversion — a warm lid aloft that traps rising air until daytime heating or lift breaks it.',
  lcl: 'LCL (cloud base) — the height where rising surface air cools to saturation and the cloud base forms.',
  lfc: 'LFC (level of free convection) — above this height a lifted parcel is buoyant and rises freely.',
  el: 'EL (equilibrium level) — the parcel’s storm-top / anvil height, where it finally stops rising.',
  shear: '0–6 km bulk wind shear — how much the wind changes from the surface to ~20,000 ft. Stronger shear organizes storms (supercells).',
};

// Tooltips for the derived-parameter readout cards.
const CARD_TIP = {
  'CAPE (SB)': 'Convective Available Potential Energy (surface-based), in J/kg. The fuel for thunderstorms; ~1000+ supports strong storms. Kept in J/kg by meteorological convention.',
  'CIN (SB)': 'Convective Inhibition (J/kg). Energy a parcel must overcome before rising freely — the "cap". More negative = harder for storms to start.',
  '0–6 km shear': 'Bulk wind shear, surface to ~6 km (20,000 ft). Stronger = better-organized storms.',
  '700–500 lapse': 'Mid-level temperature lapse rate (700→500 hPa) — how fast it cools with height aloft. ≥7 °C/km is steep/unstable.',
  PWAT: 'Precipitable water — all the moisture in the column condensed to liquid depth. Higher = heavier rain potential.',
  'LCL (cloud base)': 'Lifted Condensation Level — the height of cloud base for a rising surface parcel.',
};

// ── Annotated diagnostic Skew-T log-P ──────────────────────────────────────
// Renders the profile AND draws each derived convective feature as a labeled,
// physically-meaningful region: cloud base (LCL), the cap (CIN + inversion),
// the unstable layer (CAPE between LFC and EL), and the deep-shear layer. A
// teaching-mode toggle isolates each feature. All physics comes from
// soundingMath.js — nothing here is hardcoded.

// ---- Skew-T geometry (viewBox space; scales to container via width:100%) ----
const VBW = 820;
const VBH = 624;
const PADL = 48; // left margin (pressure labels)
const PADT = 14; // top margin
const PW = 600; // plot width
const PH = 548; // plot height
const xL = PADL;
const xR = PADL + PW;
const yT = PADT;
const yB = PADT + PH;
const PTOP = 125; // hPa at chart top
const PBOT = 1050; // hPa at chart bottom
const TMIN = -42; // °C at bottom-left
const TMAX = 44; // °C at bottom-right
const SKEW = 0.62; // skew slope (px right per px up, as a fraction of height)
const WINDX = xR + 60; // wind-barb column centerline

const lp = (p) => Math.log(p);
const yOf = (p) => yT + ((lp(p) - lp(PTOP)) / (lp(PBOT) - lp(PTOP))) * PH;
const xBase = (t) => xL + ((t - TMIN) / (TMAX - TMIN)) * PW;
// Skewed temperature x: isotherms tilt up-and-to-the-right.
const xOf = (t, p) => xBase(t) + SKEW * (yB - yOf(p));

const PRESSURE_LINES = [1000, 850, 700, 500, 400, 300, 200, 150];
const ISOTHERMS = [-40, -30, -20, -10, 0, 10, 20, 30, 40];
const MIXING_RATIOS = [1, 2, 4, 7, 10, 16, 24]; // g/kg
const round5 = (n) => Math.round(n / 5) * 5;

// Build an SVG polyline "path" of (T,p) sample points.
function curve(samples) {
  return samples.map(({ t, p }, i) => `${i ? 'L' : 'M'}${xOf(t, p).toFixed(1)},${yOf(p).toFixed(1)}`).join(' ');
}

// Sample pressures from pHi down to pLo (descending), inclusive-ish.
function seq(pHi, pLo, step = 10) {
  const out = [];
  for (let p = pHi; p > pLo; p -= step) out.push(p);
  out.push(pLo);
  return out;
}

// Pressure at a given height (m MSL), interpolating log-p vs height.
function pressureAtHeight(profile, z) {
  if (z <= profile[0].height) return profile[0].pressure;
  const last = profile[profile.length - 1];
  if (z >= last.height) return last.pressure;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (z >= a.height && z <= b.height) {
      const f = (z - a.height) / (b.height - a.height);
      return Math.exp(lp(a.pressure) + f * (lp(b.pressure) - lp(a.pressure)));
    }
  }
  return last.pressure;
}

// Parcel temperature at pressure p, interpolated from the lifted-parcel path.
function parcelTempAt(path, p) {
  if (p >= path[0].pressure) return path[0].temp;
  const last = path[path.length - 1];
  if (p <= last.pressure) return last.temp;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (p <= a.pressure && p >= b.pressure) {
      const f = (lp(p) - lp(a.pressure)) / (lp(b.pressure) - lp(a.pressure));
      return a.temp + f * (b.temp - a.temp);
    }
  }
  return last.temp;
}

// Dewpoint of a constant-mixing-ratio line (g/kg) at pressure p → for the grid.
function dewpointForMixingRatio(wgkg, p) {
  const w = wgkg / 1000;
  const e = (w * p) / (EPS + w);
  return dewpointFromVaporPressure(e);
}

// ---- Wind barb (kt) --------------------------------------------------------
function WindBarb({ x, y, dir, speed, color }) {
  const spd = round5(speed);
  const rad = (dir * Math.PI) / 180;
  const ux = Math.sin(rad); // unit vector toward the source (dir wind blows FROM)
  const uy = -Math.cos(rad);
  const L = 26;
  const tipX = x + ux * L;
  const tipY = y + uy * L;
  const px = uy; // perpendicular (barb) direction
  const py = -ux;
  const elems = [<line key="staff" x1={x} y1={y} x2={tipX} y2={tipY} stroke={color} strokeWidth="1.4" />];
  if (spd < 5) {
    elems.push(<circle key="calm" cx={x} cy={y} r="3.5" fill="none" stroke={color} strokeWidth="1.2" />);
    return <g>{elems}</g>;
  }
  let rem = spd;
  let d = 0; // distance from tip inward
  const BARB = 9;
  let key = 0;
  // Pennants (50 kt)
  while (rem >= 50) {
    const ax = tipX - ux * d;
    const ay = tipY - uy * d;
    const bx = tipX - ux * (d + 7);
    const by = tipY - uy * (d + 7);
    elems.push(
      <polygon
        key={`p${key++}`}
        points={`${ax},${ay} ${bx},${by} ${ax + px * BARB},${ay + py * BARB}`}
        fill={color}
      />,
    );
    rem -= 50;
    d += 9;
  }
  // Full barbs (10 kt)
  while (rem >= 10) {
    const ax = tipX - ux * d;
    const ay = tipY - uy * d;
    elems.push(<line key={`f${key++}`} x1={ax} y1={ay} x2={ax + px * BARB} y2={ay + py * BARB} stroke={color} strokeWidth="1.4" />);
    rem -= 10;
    d += 5;
  }
  // Half barb (5 kt)
  if (rem >= 5) {
    if (d === 0) d = 5; // keep a half barb off the very tip
    const ax = tipX - ux * d;
    const ay = tipY - uy * d;
    elems.push(<line key={`h${key++}`} x1={ax} y1={ay} x2={ax + px * (BARB / 2)} y2={ay + py * (BARB / 2)} stroke={color} strokeWidth="1.4" />);
  }
  return (
    <g>
      <title>{`${Math.round(dir)}° / ${spd} kt`}</title>
      {elems}
    </g>
  );
}

// ---- Layer toggle definitions ---------------------------------------------
const LAYERS = [
  { key: 'all', label: 'All' },
  { key: 'lcl', label: 'Cloud · LCL' },
  { key: 'cap', label: 'Cap · inversion' },
  { key: 'cape', label: 'CAPE · instability' },
  { key: 'shear', label: 'Shear' },
];

/**
 * @param {object} props
 * @param {Array} props.profile surface-first sounding levels
 * @param {{temp:number,dewpoint:number,pressure:number}} [props.surface] parcel override
 * @param {'imperial'|'metric'} [props.units]
 * @param {'dark'|'light'} [props.theme]
 * @param {string} [props.title]
 */
export default function DiagnosticSounding({ profile, surface, units = 'imperial', theme = 'dark', title }) {
  const [active, setActive] = useState('all');
  const uid = useId(); // unique per instance → no id collisions when multiple charts share a page

  const a = useMemo(() => analyzeSounding(profile, { surface }), [profile, surface]);
  const dim = (group) => (active === 'all' || active === group ? 1 : 0.12);

  const path = a.surfaceBased.parcelPath;
  const pSfc = profile[0].pressure;
  const pTopProf = profile[profile.length - 1].pressure;

  // ---- background grid ----
  const dryAdiabats = [];
  for (let thetaC = -30; thetaC <= 160; thetaC += 10) {
    const theta = thetaC + 273.15;
    dryAdiabats.push(seq(PBOT, PTOP, 25).map((p) => ({ p, t: temperatureFromTheta(theta, p) })));
  }
  const moistAdiabats = [];
  for (let t0 = -20; t0 <= 36; t0 += 4) {
    const pts = moistAdiabatPath(PBOT, t0, PTOP, 5).map((m) => ({ p: m.pressure, t: m.temp }));
    moistAdiabats.push(pts);
  }
  const mixingLines = MIXING_RATIOS.map((w) => seq(PBOT, 350, 25).map((p) => ({ p, t: dewpointForMixingRatio(w, p) })));

  // ---- data curves ----
  const tempCurve = curve(profile.map((l) => ({ t: l.temp, p: l.pressure })));
  const dewCurve = curve(profile.map((l) => ({ t: l.dewpoint, p: l.pressure })));
  const parcelCurve = curve(path.map((m) => ({ t: m.temp, p: m.pressure })));

  // ---- CAPE / CIN shaded polygons ----
  // Drawn between the dry-bulb parcel and dry-bulb environment curves, bounded
  // by the LFC/EL that soundingMath derives from *virtual*-temperature buoyancy.
  // Because Tv crossings differ slightly from dry-bulb crossings, the fill edge
  // can sit a fraction of a degree off the visible curve right at the LFC/EL —
  // this is the standard operational Skew-T convention (shade the Tv area).
  const polyBetween = (pHi, pLo) => {
    const ps = seq(pHi, pLo, 8);
    const up = ps.map((p) => `${xOf(parcelTempAt(path, p), p).toFixed(1)},${yOf(p).toFixed(1)}`);
    const down = ps
      .slice()
      .reverse()
      .map((p) => `${xOf(interpByPressure(profile, p, 'temp'), p).toFixed(1)},${yOf(p).toFixed(1)}`);
    return [...up, ...down].join(' ');
  };
  const capePoly = a.lfc && a.el ? polyBetween(a.lfc.pressure, a.el.pressure) : null;
  const cinPoly = a.lfc ? polyBetween(pSfc, a.lfc.pressure) : null;

  // ---- markers ----
  // All three markers ride the lifted-parcel curve (consistent convention).
  const marker = (p, parcelT) => ({ x: xOf(parcelT, p), y: yOf(p) });
  const lclM = marker(a.lcl.pressure, a.lcl.temp);
  const lfcM = a.lfc ? marker(a.lfc.pressure, parcelTempAt(path, a.lfc.pressure)) : null;
  const elM = a.el ? marker(a.el.pressure, parcelTempAt(path, a.el.pressure)) : null;
  // Flip a marker label to the left when it nears the plot's right edge, so it
  // never collides with the wind-barb column.
  const labelSide = (mx) => (mx > xR - 110 ? { x: mx - 8, anchor: 'end' } : { x: mx + 8, anchor: 'start' });

  // Anchor for an in-region value callout: a point `frac` of the way (in log-p)
  // up the layer, horizontally centered between the parcel and environment.
  const regionAnchor = (pHi, pLo, frac) => {
    const pMid = pHi * Math.pow(pLo / pHi, frac);
    const x = (xOf(parcelTempAt(path, pMid), pMid) + xOf(interpByPressure(profile, pMid, 'temp'), pMid)) / 2;
    return { x, y: yOf(pMid) };
  };
  const capeLabel = a.lfc && a.el && a.cape > 50 ? regionAnchor(a.lfc.pressure, a.el.pressure, 0.5) : null;
  const cinLabel = a.lfc && a.cin < -25 ? regionAnchor(pSfc, a.lfc.pressure, 0.3) : null;

  // ---- cap inversion band ----
  const capBand = a.cap
    ? { yTop: yOf(a.cap.topPressure), yBot: yOf(a.cap.basePressure) }
    : null;

  // ---- 0–6 km shear highlight (wind column) ----
  const p6km = pressureAtHeight(profile, profile[0].height + 6000);
  const shearHi = { yTop: yOf(p6km), yBot: yOf(pSfc) };

  // ---- readout cards ----
  const dp = (q, si) => {
    const { num, unit } = displayParts(q, si, units);
    return unit ? `${num} ${unit}` : num;
  };
  const card = (label, q, si, suffixExtra = '') => {
    const { num, unit } = displayParts(q, si, units);
    return { label, value: num, unit: unit + suffixExtra };
  };
  const shearMs = a.shear.shear0_6km == null ? null : a.shear.shear0_6km / 1.94384; // kt → m/s for the registry
  const cards = [
    card('CAPE (SB)', 'cape', a.cape),
    card('CIN (SB)', 'cin', a.cin),
    card('0–6 km shear', 'wind', shearMs),
    card('700–500 lapse', 'lapseRate', a.lapseRates.mid700_500),
    card('PWAT', 'pwat', a.pwat.mm),
    card('LCL (cloud base)', 'height', a.lcl.heightAGL, ' AGL'),
  ];

  const titleId = `skt-title-${uid}`;
  const descId = `skt-desc-${uid}`;
  const clipId = `skt-clip-${uid}`;
  // Built from the same displayParts() output as the readout cards, so the
  // screen-reader text matches the visible numbers/units in both unit systems;
  // displayParts is null-safe, so a missing lapse rate can't crash the render.
  const desc =
    `Skew-T sounding. ${a.narrative} ` +
    `SBCAPE ${dp('cape', a.cape)}, CIN ${dp('cin', a.cin)}, ` +
    `0–6 km shear ${dp('wind', shearMs)}, ` +
    `700–500 hPa lapse rate ${dp('lapseRate', a.lapseRates.mid700_500)}, ` +
    `LCL ${dp('height', a.lcl.heightAGL)} AGL` +
    (a.cap
      ? `, capping inversion ${Math.round(a.cap.basePressure)}–${Math.round(a.cap.topPressure)} hPa (+${dp('tempDelta', a.cap.strength)})`
      : ', no cap detected') +
    '.';

  // Skip levels with missing winds (don't fabricate a barb); thin if very dense.
  const windLevels = profile
    .filter((l) => Number.isFinite(l.windSpeed) && Number.isFinite(l.windDir))
    .filter((_, i, arr) => i % (arr.length > 16 ? 2 : 1) === 0);

  return (
    <div className="dsounding" data-theme={theme}>
      {title && <div className="diag-section-title">{title}</div>}

      <div className="skt-chips" role="group" aria-label="Isolate a physical feature">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            type="button"
            className={`skt-chip${active === l.key ? ' active' : ''}`}
            aria-pressed={active === l.key}
            onClick={() => setActive(l.key)}
          >
            {l.label}
          </button>
        ))}
      </div>

      <svg
        className="skt-svg"
        viewBox={`0 0 ${VBW} ${VBH}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>{title || 'Diagnostic Skew-T log-P sounding'}</title>
        <desc id={descId}>{desc}</desc>

        <clipPath id={clipId}>
          <rect x={xL} y={yT} width={PW} height={PH} />
        </clipPath>

        {/* plot background frame */}
        <rect x={xL} y={yT} width={PW} height={PH} className="skt-frame" />

        {/* background grid (clipped to plot) */}
        <g clipPath={`url(#${clipId})`}>
          {dryAdiabats.map((s, i) => (
            <path key={`da${i}`} d={curve(s)} className="skt-dryad" />
          ))}
          {moistAdiabats.map((s, i) => (
            <path key={`ma${i}`} d={curve(s)} className="skt-moistad" />
          ))}
          {mixingLines.map((s, i) => (
            <path key={`mr${i}`} d={curve(s)} className="skt-mixr" />
          ))}
          {ISOTHERMS.map((t) => (
            <line
              key={`it${t}`}
              x1={xOf(t, PBOT)}
              y1={yB}
              x2={xOf(t, PTOP)}
              y2={yT}
              className={t === 0 ? 'skt-isotherm zero' : 'skt-isotherm'}
            />
          ))}
        </g>

        {/* isobars + pressure labels (+ approximate height for this sounding) */}
        {PRESSURE_LINES.map((p) => {
          const z = p <= pSfc ? interpByPressure(profile, p, 'height') : null;
          return (
            <g key={`ib${p}`}>
              <line x1={xL} y1={yOf(p)} x2={xR} y2={yOf(p)} className="skt-isobar" />
              <text x={xL - 6} y={yOf(p) + 3} className="skt-axis" textAnchor="end">
                {p}
              </text>
              {z != null && (
                <text x={xL + 5} y={yOf(p) - 2.5} className="skt-height-axis" textAnchor="start">
                  ≈ {dp('height', z)}
                </text>
              )}
            </g>
          );
        })}
        {/* isotherm labels along the bottom — °C (standard) with °F underneath */}
        {ISOTHERMS.map((t) => (
          <g key={`itl${t}`}>
            <text x={xBase(t)} y={yB + 15} className="skt-axis" textAnchor="middle">
              {t}°
            </text>
            <text x={xBase(t)} y={yB + 26} className="skt-axis-f" textAnchor="middle">
              {Math.round(cToF(t))}°F
            </text>
          </g>
        ))}
        <text x={(xL + xR) / 2} y={yB + 42} className="skt-axis-title" textAnchor="middle">
          Temperature — °C (skewed) with °F · pressure (hPa) + approx. height (MSL) at left
        </text>

        {/* cap inversion band */}
        {capBand && (
          <g style={{ opacity: dim('cap') }}>
            <rect x={xL} y={capBand.yTop} width={PW} height={capBand.yBot - capBand.yTop} className="skt-cap-band">
              <title>{TIP.capband}</title>
            </rect>
            <text x={xL + 8} y={capBand.yTop - 5} className="skt-callout cap" textAnchor="start">
              Capping inversion — warm lid (+{dp('tempDelta', a.cap.strength)})
            </text>
          </g>
        )}

        {/* CIN (cool) + CAPE (warm) shaded areas */}
        <g clipPath={`url(#${clipId})`}>
          {cinPoly && (
            <polygon points={cinPoly} className="skt-cin" style={{ opacity: dim('cape') }}>
              <title>{TIP.cin}</title>
            </polygon>
          )}
          {capePoly && (
            <polygon points={capePoly} className="skt-cape" style={{ opacity: dim('cape') }}>
              <title>{TIP.cape}</title>
            </polygon>
          )}
        </g>

        {/* data curves (always visible — the base sounding) */}
        <g clipPath={`url(#${clipId})`}>
          <path d={parcelCurve} className="skt-parcel"><title>{TIP.parcel}</title></path>
          <path d={dewCurve} className="skt-dew"><title>{TIP.dew}</title></path>
          <path d={tempCurve} className="skt-temp"><title>{TIP.temp}</title></path>
        </g>

        {/* LCL / LFC / EL plain-language callouts */}
        <g style={{ opacity: dim('lcl') }}>
          <circle cx={lclM.x} cy={lclM.y} r="4.5" className="skt-dot lcl"><title>{TIP.lcl}</title></circle>
          <text x={labelSide(lclM.x).x} y={lclM.y + 3} textAnchor={labelSide(lclM.x).anchor} className="skt-callout lcl">
            <tspan x={labelSide(lclM.x).x} dy="-3">Cloud base</tspan>
            <tspan x={labelSide(lclM.x).x} dy="11" className="sub">~{dp('height', a.lcl.heightAGL)} AGL</tspan>
          </text>
        </g>
        {lfcM && (
          <g style={{ opacity: dim('cape') }}>
            <circle cx={lfcM.x} cy={lfcM.y} r="4.5" className="skt-dot lfc"><title>{TIP.lfc}</title></circle>
            <text x={labelSide(lfcM.x).x} y={lfcM.y + 3} textAnchor={labelSide(lfcM.x).anchor} className="skt-callout lfc">
              <tspan x={labelSide(lfcM.x).x} dy="-3">Storms take off</tspan>
              <tspan x={labelSide(lfcM.x).x} dy="11" className="sub">here (LFC)</tspan>
            </text>
          </g>
        )}
        {elM && (
          <g style={{ opacity: dim('cape') }}>
            <circle cx={elM.x} cy={elM.y} r="4.5" className="skt-dot el"><title>{TIP.el}</title></circle>
            <text x={labelSide(elM.x).x} y={elM.y + 3} textAnchor={labelSide(elM.x).anchor} className="skt-callout el">
              <tspan x={labelSide(elM.x).x} dy="-3">Storm top</tspan>
              <tspan x={labelSide(elM.x).x} dy="11" className="sub">~{dp('height', a.el.height)}</tspan>
            </text>
          </g>
        )}

        {/* in-region CAPE / CIN value callouts */}
        {capeLabel && (
          <g style={{ opacity: dim('cape') }}>
            <text x={capeLabel.x} y={capeLabel.y} textAnchor="middle" className="skt-callout cape">
              <tspan x={capeLabel.x}>CAPE {dp('cape', a.cape)}</tspan>
              <tspan x={capeLabel.x} dy="11" className="sub">the storm's fuel</tspan>
            </text>
          </g>
        )}
        {cinLabel && (
          <g style={{ opacity: dim('cape') }}>
            <text x={cinLabel.x} y={cinLabel.y} textAnchor="middle" className="skt-callout cin">
              <tspan x={cinLabel.x}>CIN {dp('cin', a.cin)}</tspan>
              <tspan x={cinLabel.x} dy="11" className="sub">energy blocking storms</tspan>
            </text>
          </g>
        )}

        {/* wind barbs + 0–6 km shear highlight */}
        <g style={{ opacity: dim('shear') }}>
          <rect
            x={WINDX - 34}
            y={shearHi.yTop}
            width={68}
            height={shearHi.yBot - shearHi.yTop}
            rx={4}
            className="skt-shear-hi"
          >
            <title>{TIP.shear}</title>
          </rect>
          <text x={WINDX} y={shearHi.yTop - 5} className="skt-anno shear" textAnchor="middle">
            0–6 km
          </text>
          {windLevels.map((l, i) => (
            <WindBarb
              key={`wb${i}`}
              x={WINDX}
              y={yOf(l.pressure)}
              dir={l.windDir}
              speed={l.windSpeed}
              color="var(--skt-barb)"
            />
          ))}
        </g>
      </svg>

      {/* storm-mode narrative — real text for screen readers / search */}
      <p className="skt-narrative">
        <strong>Storm-mode call:</strong> {a.narrative}
      </p>

      {/* derived-parameter readout — hover any card for what it means */}
      <div className="diag-grid skt-readout">
        {cards.map((c) => (
          <div key={c.label} className="metric" title={CARD_TIP[c.label]}>
            <div className="m-label">
              {c.label}
              {CARD_TIP[c.label] ? <span className="m-info"> ⓘ</span> : null}
            </div>
            <div className="m-value">
              {c.value}
              {c.unit ? <span className="m-unit"> {c.unit}</span> : null}
            </div>
          </div>
        ))}
      </div>

      {/* legend — hover any swatch for an explanation */}
      <div className="skt-legend">
        <span title={TIP.temp}><i className="sw temp" /> Temperature</span>
        <span title={TIP.dew}><i className="sw dew" /> Dewpoint</span>
        <span title={TIP.parcel}><i className="sw parcel" /> Lifted parcel</span>
        <span title={TIP.cape}><i className="sw cape" /> CAPE</span>
        <span title={TIP.cin}><i className="sw cin" /> CIN (cap)</span>
        <span title={TIP.capband}><i className="sw capband" /> Inversion</span>
      </div>
    </div>
  );
}
