// Build provenance — which commit is this copy of the app?
//
// WHY THIS EXISTS
// ---------------
// Production sat three commits behind `origin/main` and nothing in the running
// app said so. The deploy looked healthy from every angle available to a user:
// the page rendered, the panels loaded, the imagery was live. Working out that
// it was stale took reading hashed bundle filenames and grepping the minified
// JS for a CSS class name. That is not a diagnosis anyone should have to repeat.
//
// So the commit travels with the build. Two surfaces consume this module:
//
//   • vite.config.js bakes it into the bundle as `__APP_BUILD__`, which the
//     footer renders. Baked rather than fetched because the Conductor embed
//     serves this app as static files from `/weather/` — a runtime fetch would
//     need base-path handling and would fail exactly where provenance matters
//     most, in a vendored copy someone else deployed.
//   • server/index.js reports it on /api/health, so a deploy can be verified
//     with one curl instead of bundle archaeology.
//
// Deliberately NOT written to a `BUILD_INFO.json`: Conductor's build:weather
// stamps its own `public/weather/BUILD_INFO.json` over this app's copied dist/,
// and its vendoredDashboard.test.mjs asserts that file's shape. A same-named
// file here would be clobbered on vendoring and would collide with a contract
// owned by the other repo. The field names below still mirror Conductor's
// readDashboardProvenance() so the two stamps read the same way side by side.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run git in the repo root. Returns trimmed stdout, or null if git can't answer. */
function git(args) {
  try {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    if (r.error || r.status !== 0) return null;
    return String(r.stdout).trim();
  } catch {
    return null;
  }
}

/**
 * The commit this build came from.
 *
 * Git first, because it is the only source that can answer `dirty` and it works
 * for every local build. Render's RENDER_GIT_* env vars are the fallback: the
 * build container has them even when `.git` is shallow or absent, which is the
 * case this whole module exists to cover.
 *
 * Returns null when neither source knows — a fresh tarball with no git and no
 * Render env. Callers render "dev" for that rather than inventing a SHA.
 */
export function readProvenance() {
  const sha = git(['rev-parse', 'HEAD']) || process.env.RENDER_GIT_COMMIT || null;
  if (!sha) return null;

  // `--abbrev-ref HEAD` says "HEAD" on a detached checkout, which is what Render
  // does. The env var carries the real branch name there.
  const gitBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch =
    (gitBranch && gitBranch !== 'HEAD' ? gitBranch : null) || process.env.RENDER_GIT_BRANCH || null;

  const status = git(['status', '--porcelain']);

  return {
    sha,
    shortSha: git(['rev-parse', '--short', 'HEAD']) || sha.slice(0, 7),
    branch,
    commitDate: git(['log', '-1', '--format=%cI']),
    subject: git(['log', '-1', '--format=%s']),
    // Unknowable without git. Conductor's stamp resolves the same way: absent
    // git metadata reads as clean rather than as a scary unknown.
    dirty: status !== null && status !== '',
  };
}

/**
 * The provenance plus a build timestamp, for the bundler only.
 *
 * `builtAt` is stamped when Vite loads this module, so it genuinely is build
 * time for `vite build` (and dev-server start for `vite`, which is the honest
 * answer to "how old is the thing I'm looking at" in that context).
 *
 * The server deliberately does NOT use this. It never built dist/ — that
 * happened in a separate step, possibly on a different machine — so the only
 * timestamp it can honestly report is its own boot time, and calling that
 * `builtAt` would be a lie in the exact field someone consults to catch a stale
 * deploy. server/index.js pairs readProvenance() with `startedAt` instead.
 */
export function buildStamp() {
  return {
    builtAt: new Date().toISOString(),
    app: readProvenance(),
  };
}

/**
 * Short human label for the footer: `a068051`, `a068051-dirty`, or `dev`.
 *
 * "dev" is the graceful degradation — never "undefined", never a blank gap
 * where a reader would not know whether the stamp is missing or the build is.
 */
export function buildLabel(stamp) {
  const app = stamp?.app;
  if (!app?.shortSha) return 'dev';
  return app.dirty ? `${app.shortSha}-dirty` : app.shortSha;
}
