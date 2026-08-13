// Frontend view of the build stamp vite.config.js baked in as `__APP_BUILD__`.
//
// The `typeof` guard is load-bearing, not defensive noise: `__APP_BUILD__` is a
// bare global that only exists because Vite's `define` textually replaces it.
// Any consumer that evaluates this module without that replacement — a bundler
// configured elsewhere, a plain node import — would throw ReferenceError on a
// direct reference. `typeof` on an undeclared identifier is the one form that
// does not.
//
// See scripts/buildInfo.mjs for where the values come from and why they are
// baked rather than fetched.

const RAW = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : null;

/** `{ builtAt, app: { sha, shortSha, branch, commitDate, subject, dirty } }` — or null. */
export const BUILD = RAW;

/**
 * Short label for display: `a068051`, `a068051-dirty`, or `dev`.
 *
 * Mirrors buildLabel() in scripts/buildInfo.mjs. Duplicated rather than shared
 * because that module runs in node (child_process, node:path) and must not be
 * pulled into the browser bundle to compute one string.
 */
export const BUILD_LABEL = (() => {
  const app = RAW?.app;
  if (!app?.shortSha) return 'dev';
  return app.dirty ? `${app.shortSha}-dirty` : app.shortSha;
})();

/**
 * Build date as `YYYY-MM-DD`, or null when there is no stamp.
 *
 * Date only, not time: the footer is answering "which build is this" at a
 * glance, and a full timestamp there reads as data the reader should care
 * about. The exact ISO instant is on /api/health for when it matters.
 */
export const BUILD_DATE = RAW?.builtAt ? RAW.builtAt.slice(0, 10) : null;
