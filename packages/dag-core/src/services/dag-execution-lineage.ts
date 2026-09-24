import type { IDagExecutionLineage } from '../types/domain.js';

/** Validate persisted lineage before it can authorize another composite child launch. */
export function decodeDagExecutionLineage(value: unknown): IDagExecutionLineage | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid persisted DAG execution lineage');
  }
  const record = value as Record<string, unknown>;
  const hasParentRunId = record.parentRunId !== undefined;
  const parentRunIdOk =
    !hasParentRunId ||
    (typeof record.parentRunId === 'string' && record.parentRunId.length > 0);
  if (
    typeof record.rootRunId !== 'string' || record.rootRunId.length === 0 ||
    !parentRunIdOk ||
    !Number.isSafeInteger(record.depth) || (record.depth as number) < 0 ||
    (record.maxDepth !== undefined &&
      (!Number.isSafeInteger(record.maxDepth) || (record.maxDepth as number) < 1)) ||
    !Array.isArray(record.ancestorCompositeNodeTypes) ||
    !record.ancestorCompositeNodeTypes.every(
      (type: unknown) => typeof type === 'string' && type.length > 0,
    )
  ) {
    throw new Error('Invalid persisted DAG execution lineage');
  }
  const depth = record.depth as number;
  const ancestorCount = record.ancestorCompositeNodeTypes.length;
  // A root run (depth 0) has crossed no composite boundary yet, so it carries neither a parent nor
  // any ancestor; a child run (depth >= 1) must carry both, one ancestor per crossed boundary. A
  // record mixing the two shapes (e.g. depth 0 with a parent) is inconsistent, not a fresh root.
  const shapeOk =
    depth === 0 ? !hasParentRunId && ancestorCount === 0 : hasParentRunId && ancestorCount === depth;
  if (!shapeOk) {
    throw new Error('Invalid persisted DAG execution lineage');
  }
  return {
    rootRunId: record.rootRunId,
    ...(hasParentRunId ? { parentRunId: record.parentRunId as string } : {}),
    depth,
    ...(record.maxDepth === undefined ? {} : { maxDepth: record.maxDepth as number }),
    ancestorCompositeNodeTypes: [...record.ancestorCompositeNodeTypes] as string[],
  };
}
