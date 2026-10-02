import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = fileURLToPath(new URL('./src', import.meta.url));
// Resolve the workspace package from source so web does not depend on a prior shared build.
const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': src, '@kacp/shared': shared },
  },
  server: { host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 800 },
});
