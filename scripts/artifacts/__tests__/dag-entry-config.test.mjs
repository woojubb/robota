import { expect, it } from 'vitest';
import cli from '../../../packages/dag-cli/tsdown.config.ts';

it('dag-cli excludes CJS bin emission in compiler configuration', () => {
  const configuration = cli;
  expect(Array.isArray(configuration)).toBe(true);
  const index = configuration.find((config) => config.entry.includes('src/index.ts'));
  const binary = configuration.find((config) => config.entry.includes('src/bin.ts'));
  expect(index.format).toEqual(['esm', 'cjs']);
  expect(binary.format).toEqual(['esm']);
  expect(index.outDir).toBe('dist/node');
  expect(binary.outDir).toBe('dist/node');
});
