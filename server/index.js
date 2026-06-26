// Express proxy server.
//
// Purpose: a few weather data sources block cross-origin browser requests or
// hotlinking (notably SPC mesoanalysis and University of Wyoming soundings).
// We fetch them server-side and pipe the bytes back so the frontend can render
// them as REAL INLINE <img> elements instead of click-out links.
//
// CORS-friendly sources (NWS, Open-Meteo, RainViewer, GOES CDN) are fetched
// directly from the browser and never touch this server.

import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const app = express();
const PORT = process.env.PORT || 3001;

// Descriptive User-Agent — NWS requires one, and it's polite for the others.
const UA =
  'wx-dashboard/1.0 (local meteorological dashboard; contact: local user)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Pipe an upstream image through to the client, preserving content-type.
async function pipeImage(res, url, label, extraHeaders = {}) {
  const upstream = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'image/avif,image/webp,image/png,image/gif,image/*,*/*;q=0.8',
      ...extraHeaders,
    },
    redirect: 'follow',
  });
  if (!upstream.ok) {
    return res
      .status(502)
      .json({ error: `${label} upstream returned ${upstream.status}`, url });
  }
  const ct = upstream.headers.get('content-type') || '';
  // Some sources return an HTML error page with 200; guard against that so the
  // <img> tag gets a real error instead of a broken image of HTML.
  if (!ct.startsWith('image/')) {
    return res
      .status(502)
      .json({ error: `${label} did not return an image (${ct})`, url });
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.set('Content-Type', ct);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(buf);
}

// Candidate synoptic radiosonde times, most-recent first, stepping back 12h.
// Backed off ~3h so the data has had time to post.
function synopticCandidates(now = new Date(), count = 6) {
  let t = new Date(now.getTime() - 3 * 3600 * 1000);
  const baseHour = t.getUTCHours() >= 12 ? 12 : 0;
  t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), baseHour));
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(t.getTime() - i * 12 * 3600 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    out.push({ yyyy, mm, dd, hh, label: `${yyyy}-${mm}-${dd} ${hh}Z` });
  }
  return out;
}

// UWyo serves the actual skew-T GIF at a direct, predictable path. (The cgi-bin
// "GIF:SKEWT" endpoint now returns an HTML wrapper pointing at this URL.)
function soundingImageUrl(stnm, c) {
  return `https://weather.uwyo.edu/upperair/images/${c.yyyy}${c.mm}${c.dd}${c.hh}.${stnm}.skewt.parc.gif`;
}

// Resolve the most recent AVAILABLE sounding for a station, with a small cache
// so /api/sounding and /api/sounding-info don't both re-download it.
const soundingCache = new Map(); // stnm -> { ts, when, ct, buf }
const SOUNDING_TTL = 10 * 60 * 1000;

async function resolveSounding(stnm) {
  const cached = soundingCache.get(stnm);
  if (cached && Date.now() - cached.ts < SOUNDING_TTL) return cached;

  for (const c of synopticCandidates()) {
    const url = soundingImageUrl(stnm, c);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.startsWith('image/')) {
        const entry = { ts: Date.now(), when: c, ct, buf: Buffer.from(await r.arrayBuffer()) };
        soundingCache.set(stnm, entry);
        return entry;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'wx-dashboard-proxy', port: PORT });
});

// University of Wyoming skew-T sounding (GIF), most recent available 00Z/12Z.
app.get('/api/sounding', async (req, res) => {
  try {
    const stnm = String(req.query.station || '72489').replace(/\D/g, '');
    const r = await resolveSounding(stnm);
    if (!r) {
      return res
        .status(502)
        .json({ error: 'No recent sounding image available for station ' + stnm });
    }
    res.set('Content-Type', r.ct);
    res.set('Cache-Control', 'public, max-age=300');
    res.send(r.buf);
  } catch (err) {
    res.status(502).json({ error: 'sounding proxy failed', detail: String(err) });
  }
});

// Report which sounding time the UI is actually showing (for the label).
app.get('/api/sounding-info', async (req, res) => {
  try {
    const stnm = String(req.query.station || '72489').replace(/\D/g, '');
    const r = await resolveSounding(stnm);
    if (!r) return res.json({ found: false });
    res.json({ found: true, label: r.when.label, station: stnm });
  } catch (err) {
    res.json({ found: false, error: String(err) });
  }
});

// SPC mesoanalysis parameter image (GIF). ?sector=12&parm=mucp
// Correct path:  /exper/mesoanalysis/s{N}/{parm}/{parm}.gif
app.get('/api/spc', async (req, res) => {
  try {
    const sector = String(req.query.sector || '12').replace(/\D/g, '');
    const parm = String(req.query.parm || 'mucp').replace(/[^a-z0-9]/gi, '');
    const url = `https://www.spc.noaa.gov/exper/mesoanalysis/s${sector}/${parm}/${parm}.gif`;
    await pipeImage(res, url, 'SPC mesoanalysis');
  } catch (err) {
    res.status(502).json({ error: 'spc proxy failed', detail: String(err) });
  }
});

// SPC convective + fire-weather outlook images (now served as .png).
const SPC_OUTLOOKS = {
  day1cat: 'https://www.spc.noaa.gov/products/outlook/day1otlk.png',
  day2cat: 'https://www.spc.noaa.gov/products/outlook/day2otlk.png',
  day3cat: 'https://www.spc.noaa.gov/products/outlook/day3otlk.png',
  day1fire: 'https://www.spc.noaa.gov/products/fire_wx/day1otlk_fire.png',
  day2fire: 'https://www.spc.noaa.gov/products/fire_wx/day2otlk_fire.png',
};
app.get('/api/spc-outlook', async (req, res) => {
  try {
    const url = SPC_OUTLOOKS[String(req.query.img)];
    if (!url) return res.status(400).json({ error: 'unknown outlook image' });
    await pipeImage(res, url, 'SPC outlook');
  } catch (err) {
    res.status(502).json({ error: 'spc outlook proxy failed', detail: String(err) });
  }
});

// NDOT 511 (nvroads.com) sends X-Frame-Options: SAMEORIGIN, so it can't be
// iframed directly. We fetch the top document, strip the framing header, and
// inject <base href> so its root-relative assets still load from nvroads.
// (Caltrans QuickMap has no such header and is embedded directly, no proxy.)
app.get('/api/ndot', async (_req, res) => {
  try {
    const upstreamUrl = 'https://www.nvroads.com/';
    const r = await fetch(upstreamUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!r.ok) {
      return res.status(502).send(`<p>NDOT 511 upstream returned ${r.status}.</p>`);
    }
    let html = await r.text();
    // Make root-relative URLs resolve back to nvroads.com.
    if (!/<base\s/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${upstreamUrl}">`);
    }
    // Never echo a framing-blocker; set permissive framing for localhost.
    res.removeHeader('X-Frame-Options');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Security-Policy', "frame-ancestors 'self' http://localhost:*");
    res.send(html);
  } catch (err) {
    res.status(502).send(`<p>NDOT 511 proxy failed: ${String(err)}</p>`);
  }
});

// Zoom Earth (zoom.earth) — live satellite + storm/hurricane tracking. It sends
// X-Frame-Options: SAMEORIGIN, so (like NDOT) it can't be iframed directly. We
// fetch the top document, strip the framing header + any CSP <meta>, and inject
// <base href> so its root-relative assets keep loading from zoom.earth. The map
// view is steered client-side via the iframe URL hash (#view=lat,lon,zoomz).
app.get('/api/zoomearth', async (_req, res) => {
  try {
    const upstreamUrl = 'https://zoom.earth/';
    const r = await fetch(upstreamUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!r.ok) {
      return res.status(502).send(`<p>Zoom Earth upstream returned ${r.status}.</p>`);
    }
    let html = await r.text();
    // Drop any in-document CSP that could re-impose frame-ancestors.
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
    // Make root-relative URLs resolve back to zoom.earth.
    if (!/<base\s/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${upstreamUrl}">`);
    }
    // Never echo a framing-blocker; allow same-origin (prod) + localhost (dev).
    res.removeHeader('X-Frame-Options');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Security-Policy', "frame-ancestors 'self' http://localhost:*");
    res.send(html);
  } catch (err) {
    res.status(502).send(`<p>Zoom Earth proxy failed: ${String(err)}</p>`);
  }
});

// ---------------------------------------------------------------------------
// Model forecast maps — Tropical Tidbits graphics (latest full model runs).
// TT hotlink-protects its images, so we fetch server-side with a Referer and
// pipe them inline. Everything is whitelisted (no open proxy).
// ---------------------------------------------------------------------------
const MODEL_CFG = {
  gfs: { cadenceH: 6, backoffH: 5, maxFrame: 49 },
  nam: { cadenceH: 6, backoffH: 4, maxFrame: 29 },
  ecmwf: { cadenceH: 12, backoffH: 8, maxFrame: 41 },
};
const MODEL_FIELDS = new Set(['mslp_pcpn', 'apcpn', 'ref_frzn', 'mslp_wind']);
const MODEL_REGIONS = new Set(['us', 'wus', 'namer']);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

function runCandidates(model, now = new Date(), count = 4) {
  const cfg = MODEL_CFG[model] || MODEL_CFG.gfs;
  let t = new Date(now.getTime() - cfg.backoffH * 3600 * 1000);
  const h = Math.floor(t.getUTCHours() / cfg.cadenceH) * cfg.cadenceH;
  t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), h));
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(t.getTime() - i * cfg.cadenceH * 3600 * 1000);
    const stamp = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}`;
    out.push({ stamp, label: `${pad2(d.getUTCHours())}Z ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` });
  }
  return out;
}

const ttUrl = (model, run, field, region, frame) =>
  `https://www.tropicaltidbits.com/analysis/models/${model}/${run}/${model}_${field}_${region}_${frame}.png`;

const modelRunCache = new Map(); // model -> { ts, run }
async function resolveModelRun(model) {
  const cached = modelRunCache.get(model);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.run;
  for (const c of runCandidates(model)) {
    try {
      const r = await fetch(ttUrl(model, c.stamp, 'mslp_pcpn', 'us', 1), {
        headers: { 'User-Agent': UA, Referer: 'https://www.tropicaltidbits.com/' },
      });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.startsWith('image/')) {
        const run = { stamp: c.stamp, label: c.label };
        modelRunCache.set(model, { ts: Date.now(), run });
        return run;
      }
    } catch {
      /* next candidate */
    }
  }
  return null;
}

app.get('/api/model-info', async (req, res) => {
  const model = String(req.query.model || 'gfs');
  if (!MODEL_CFG[model]) return res.status(400).json({ error: 'unknown model' });
  const run = await resolveModelRun(model);
  if (!run) return res.json({ found: false, model });
  res.json({ found: true, model, run: run.stamp, label: run.label, maxFrame: MODEL_CFG[model].maxFrame });
});

app.get('/api/model', async (req, res) => {
  try {
    const model = String(req.query.model || 'gfs');
    const field = String(req.query.field || 'mslp_pcpn');
    const region = String(req.query.region || 'us');
    const frame = Math.max(1, Math.min(99, parseInt(req.query.frame, 10) || 1));
    if (!MODEL_CFG[model] || !MODEL_FIELDS.has(field) || !MODEL_REGIONS.has(region)) {
      return res.status(400).json({ error: 'invalid model/field/region' });
    }
    let run = String(req.query.run || '').replace(/\D/g, '');
    if (run.length !== 10) {
      const resolved = await resolveModelRun(model);
      if (!resolved) return res.status(502).json({ error: 'no recent model run found for ' + model });
      run = resolved.stamp;
    }
    await pipeImage(res, ttUrl(model, run, field, region, frame), 'model map', {
      Referer: 'https://www.tropicaltidbits.com/',
    });
  } catch (err) {
    res.status(502).json({ error: 'model proxy failed', detail: String(err) });
  }
});

// In production (e.g. on Render) this same service also serves the built
// frontend, so the whole dashboard is one origin/URL. In dev the frontend is
// served by Vite (5173) and proxies /api here, so this block is inert.
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback for client routes — but never swallow /api/*.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log('[proxy] serving built frontend from /dist');
}

app.listen(PORT, () => {
  console.log(`[proxy] wx-dashboard listening on http://localhost:${PORT}`);
  console.log(`[proxy] inline image routes: /api/sounding, /api/spc, /api/spc-outlook, /api/ndot, /api/zoomearth, /api/model`);
});
