import { expect, it } from 'vitest';
import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';

it('does not project a product category for a category-less custom node', async () => {
  const provider = new LocalDagRuntimeProvider({
    executionRoot: process.cwd(),
    nodeRegistry: [{
      nodeType: 'custom', displayName: 'Custom', category: undefined as unknown as string,
      inputs: [], outputs: [], configSchemaDefinition: null,
      taskHandler: { execute: async () => ({ ok: true, value: {} }) },
    }],
  });
  expect((await provider.listNodes())[0]?.category).toBe('Custom');
});
