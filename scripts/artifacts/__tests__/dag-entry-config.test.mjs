import { expect, it } from 'vitest';
import cli from '../../../packages/dag-cli/tsdown.config.ts';
import server from '../../../packages/dag-mcp-server/tsdown.config.ts';

it.each([
  ['dag-cli', cli],
  ['dag-mcp-server', server],
])('%s excludes CJS bin emission in compiler configuration', (_name, configuration) => {
  expect(Array.isArray(configuration)).toBe(true);
  const index = configuration.find((config) => config.entry.includes('src/index.ts'));
  const binary = configuration.find((config) => config.entry.includes('src/bin.ts'));
  expect(index.format).toEqual(['esm', 'cjs']);
  expect(binary.format).toEqual(['esm']);
  expect(index.outDir).toBe('dist/node');
  expect(binary.outDir).toBe('dist/node');
});
