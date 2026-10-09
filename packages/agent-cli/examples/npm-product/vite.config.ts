import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  if (mode !== 'cedar' && mode !== 'amber') throw new Error('Choose a fixed product renderer mode.');
  return {
    root: 'src/renderer',
    base: './',
    build: { outDir: resolve(import.meta.dirname, 'dist/renderer', mode), emptyOutDir: true },
    plugins: [react(), tailwindcss()],
  };
});
