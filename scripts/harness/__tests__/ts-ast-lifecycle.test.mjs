import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ live: 0, updates: [] }));
vi.mock('@typescript/native-preview/unstable/sync', () => ({
  API: class {
    updateSnapshot(update) {
      state.updates.push(update);
      state.live += 1;
      return {
        getDefaultProjectForFile: () => ({
          program: { getSourceFile: () => ({ statements: [] }) },
        }),
        dispose: () => {
          state.live -= 1;
        },
      };
    }
  },
}));

import { withSourceFile } from '../lib/ts-ast.mjs';

it('releases a scoped parse snapshot after success and after visitor failure', () => {
  expect(withSourceFile('fixture.ts', '', (source) => source.statements.length)).toBe(0);
  expect(state.live).toBe(0);
  expect(() =>
    withSourceFile('fixture.ts', '', () => {
      throw new Error('visitor failed');
    }),
  ).toThrow('visitor failed');
  expect(state.live).toBe(0);
});

it('declares the closed virtual source deleted so later snapshots cannot retain its cache', () => {
  withSourceFile('first.ts', '', () => undefined);
  const firstPath = state.updates.at(-1).openFiles[0];
  withSourceFile('second.ts', '', () => undefined);
  expect(state.updates.at(-1).fileChanges.deleted).toEqual([firstPath]);
});
