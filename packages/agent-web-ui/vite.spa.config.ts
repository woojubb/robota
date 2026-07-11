import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'spa',
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/spa',
    emptyOutDir: true,
    rollupOptions: {
      // Two static entries: the localhost monitor (index.html) and the Stage-D remote client (remote.html).
      input: {
        index: resolve(__dirname, 'spa/index.html'),
        remote: resolve(__dirname, 'spa/remote.html'),
      },
    },
  },
});
