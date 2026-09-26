import { defineConfig } from 'vitest/config';

/** The shell's own logic (sidecar spawn, supervision) runs under node; the page is tested in agent-gui-web. */
export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts'],
    environment: 'node',
  },
});
