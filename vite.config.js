import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Sign-Up calls go direct to sandbox.signup.nmi.com (CORS *).
 * Gateway (customers / pay / query) has no browser CORS — Vite proxies
 * /nmi-gateway → https://sandbox.nmi.com/api so those still work without our Node API.
 */
export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    // Expose NMI_* from .env to the browser (sandbox sample only — not for production).
    envPrefix: ['VITE_', 'NMI_'],
    server: {
      port: 5190,
      strictPort: true,
      // Deep-link tabs (/signup, /merchants, …) reload → index.html
      proxy: {
        '/nmi-gateway': {
          target: 'https://sandbox.nmi.com',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/nmi-gateway/, '/api'),
        },
      },
    },
    preview: {
      port: 5190,
      strictPort: true,
    },
    appType: 'spa',
  };
});
