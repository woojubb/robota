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
  },
});
