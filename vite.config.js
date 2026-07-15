import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  // Base path for deployment — all asset URLs will be prefixed with this
  base: '/lab/hydroviz/',

  plugins: [cesium()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api/usgs-elevation': {
        target: 'https://epqs.nationalmap.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/usgs-elevation/, ''),
        secure: true,
      },
      '/api/google-elevation': {
        target: 'https://maps.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/google-elevation/, ''),
        secure: true,
      },
      '/api/google-places': {
        target: 'https://maps.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/google-places/, ''),
        secure: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
