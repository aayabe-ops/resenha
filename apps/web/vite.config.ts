import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Em desenvolvimento, a API roda no `wrangler dev` (apps/api).
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
