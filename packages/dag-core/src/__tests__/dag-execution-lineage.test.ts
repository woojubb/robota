import { expect, it } from 'vitest';
import { decodeDagExecutionLineage } from '../services/dag-execution-lineage.js';

it('accepts a complete persisted child lineage and absent legacy root lineage', () => {
  const lineage = {
    rootRunId: 'root', parentRunId: 'parent', depth: 2, maxDepth: 3,
    ancestorCompositeNodeTypes: ['outer', 'inner'],
  };
  expect(decodeDagExecutionLineage(lineage)).toEqual(lineage);
  expect(decodeDagExecutionLineage(undefined)).toBeUndefined();
  expect(decodeDagExecutionLineage(null)).toBeUndefined();
});

it.each([
  {},
  { rootRunId: 'root', parentRunId: 'parent', depth: 0, ancestorCompositeNodeTypes: [] },
  { rootRunId: 'root', depth: 1, ancestorCompositeNodeTypes: ['outer'] },
  { rootRunId: 'root', parentRunId: 'parent', depth: 2, ancestorCompositeNodeTypes: ['outer'] },
  { rootRunId: 'root', parentRunId: 'parent', depth: 1, ancestorCompositeNodeTypes: [''] },
  { rootRunId: 'root', parentRunId: 'parent', depth: 1, maxDepth: 0, ancestorCompositeNodeTypes: ['outer'] },
  '{"rootRunId":"root"}',
])('does not reset malformed persisted child lineage to a fresh root: %j', (lineage) => {
  expect(() => decodeDagExecutionLineage(lineage)).toThrow('Invalid persisted DAG execution lineage');
});
