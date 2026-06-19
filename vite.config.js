import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Express proxy runs on 3001. We forward /api/* to it so the browser only
// ever talks same-origin — this is how the SPC mesoanalysis + UWyo sounding
// images render INLINE (those hosts block hotlinking/CORS from the browser).
export default defineConfig({
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
