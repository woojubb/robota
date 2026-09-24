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

it('accepts a root lineage (depth 0, no parent, no ancestors), with or without a depth cap', () => {
  const bareRoot = { rootRunId: 'root', depth: 0, ancestorCompositeNodeTypes: [] };
  expect(decodeDagExecutionLineage(bareRoot)).toEqual(bareRoot);

  const cappedRoot = { rootRunId: 'root', depth: 0, maxDepth: 2, ancestorCompositeNodeTypes: [] };
  expect(decodeDagExecutionLineage(cappedRoot)).toEqual(cappedRoot);
});

it.each([
  // depth 0 mixed with a shape that only belongs to a child.
  { rootRunId: 'root', depth: 0, parentRunId: 'parent', ancestorCompositeNodeTypes: [] },
  { rootRunId: 'root', depth: 0, ancestorCompositeNodeTypes: ['outer'] },
])('rejects a depth-0 record carrying child-only fields: %j', (lineage) => {
  expect(() => decodeDagExecutionLineage(lineage)).toThrow('Invalid persisted DAG execution lineage');
});
