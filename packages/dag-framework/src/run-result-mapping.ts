// Shared mapping from a terminal run's persisted state (dagRun + taskRuns) to the runtime-provider
// result contract. Used by both LocalDagRuntimeProvider and HttpDagRuntimeProvider so the two stay
// behaviourally identical (single source — no per-provider drift).

import type { IDagRun, IDagRuntimeResult, ITaskRun } from '@robota-sdk/dag-core';

const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled']);

/** A DAG run has reached a terminal lifecycle state (no further transitions). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

function parseOutputSnapshot(snapshot: string | undefined): Record<string, unknown> {
  if (!snapshot) return {};
  let parsed: unknown;
  // allow-fallback: outputSnapshot is advisory display data; malformed JSON is skipped gracefully
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    return {};
  } // allow-fallback: malformed advisory display data is skipped
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

/** Flatten every task run's output snapshot into `{ "<nodeId>.<key>": value }`. */
export function collectOutputsFromTaskRuns(taskRuns: ITaskRun[]): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const taskRun of taskRuns) {
    const snapshot = parseOutputSnapshot(taskRun.outputSnapshot);
    for (const [k, v] of Object.entries(snapshot)) {
      outputs[`${taskRun.nodeId}.${k}`] = v;
    }
  }
  return outputs;
}

/** The last successful task's first string output — a best-effort "final text" of the run. */
export function extractFinalText(taskRuns: ITaskRun[]): string | undefined {
  for (let i = taskRuns.length - 1; i >= 0; i--) {
    const taskRun = taskRuns[i];
    if (!taskRun || taskRun.status !== 'success') continue;
    const snapshot = parseOutputSnapshot(taskRun.outputSnapshot);
    for (const val of Object.values(snapshot)) {
      if (typeof val === 'string') return val;
    }
  }
  return undefined;
}

/** The last failed task's error, prefixed with its node id. */
export function extractRunError(taskRuns: ITaskRun[]): string | undefined {
  for (let i = taskRuns.length - 1; i >= 0; i--) {
    const taskRun = taskRuns[i];
    if (!taskRun) continue;
    if (taskRun.status === 'failed' && taskRun.errorMessage) {
      return `${taskRun.nodeId}: ${taskRun.errorMessage}`;
    }
  }
  return undefined;
}

/** Map a terminal run (dagRun + taskRuns) to the `IDagRuntimeResult` contract. */
export function mapRunToResult(
  dagRun: IDagRun,
  taskRuns: ITaskRun[],
  durationMs: number,
): IDagRuntimeResult {
  const ok = dagRun.status === 'success';
  return {
    ok,
    outputs: collectOutputsFromTaskRuns(taskRuns),
    durationMs,
    error: ok ? undefined : extractRunError(taskRuns),
  };
}
