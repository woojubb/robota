import type { IDagExecutionLineage } from '../types/domain.js';

/** Validate persisted lineage before it can authorize another composite child launch. */
export function decodeDagExecutionLineage(value: unknown): IDagExecutionLineage | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid persisted DAG execution lineage');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.rootRunId !== 'string' || record.rootRunId.length === 0 ||
    typeof record.parentRunId !== 'string' || record.parentRunId.length === 0 ||
    !Number.isSafeInteger(record.depth) || (record.depth as number) < 1 ||
    (record.maxDepth !== undefined &&
      (!Number.isSafeInteger(record.maxDepth) || (record.maxDepth as number) < 1)) ||
    !Array.isArray(record.ancestorCompositeNodeTypes) ||
    record.ancestorCompositeNodeTypes.length !== record.depth ||
    !record.ancestorCompositeNodeTypes.every(
      (type: unknown) => typeof type === 'string' && type.length > 0,
    )
  ) {
    throw new Error('Invalid persisted DAG execution lineage');
  }
  return {
    rootRunId: record.rootRunId,
    parentRunId: record.parentRunId,
    depth: record.depth as number,
    ...(record.maxDepth === undefined ? {} : { maxDepth: record.maxDepth as number }),
    ancestorCompositeNodeTypes: [...record.ancestorCompositeNodeTypes] as string[],
  };
}
