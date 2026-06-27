import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Express proxy runs on 3001. We forward /api/* to it so the browser only
// ever talks same-origin — this is how the SPC mesoanalysis + UWyo sounding
// images render INLINE (those hosts block hotlinking/CORS from the browser).
//
// `base` is conditional. Dev and the standalone build live at the root `/`. The
// Conductor-targeted build (`CONDUCTOR_BUILD=true`, via `npm run build:conductor`)
// emits asset URLs under `/weather/` so the dashboard can be served same-origin
// from Conductor at `/weather/`. (Only static asset URLs get the prefix; the
// frontend's relative `/api/...` calls are unaffected and stay root-absolute.)
export default defineConfig({
  base: process.env.CONDUCTOR_BUILD === 'true' ? '/weather/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
