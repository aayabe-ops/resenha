import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Em desenvolvimento, a API roda no `wrangler dev` (apps/api).
    proxy: {
      // ws: true para o WebSocket da resenha ao vivo
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
});
