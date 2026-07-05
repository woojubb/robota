/** Handlers for run-related MCP tools: dag_run_definition, dag_runs_poll_progress, dag_runs_cancel, dag_run_file */

import { readFile } from 'node:fs/promises';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { TPortPayload } from '@robota-sdk/dag-core';
import { LocalDagRunner, createCliNodeRegistry } from '../../local-runner/index.js';
import type { ILocalMcpServerContext } from '../context.js';
import type { IRunRecord } from '../types.js';
import {
  makeTextResult,
  makeErrorResult,
  resolveErrorMessage,
  collectOutputs,
  parseDefinitionArg,
  DEFAULT_TIMEOUT_MS,
  UTF8_ENCODING,
} from '../utils.js';

/** Execute a DAG definition in-process and return an MCP result. */
export async function runDagDefinition(
  dag: IDagDefinition,
  inputs: TPortPayload,
  timeoutMs: number,
  createRunner: (() => LocalDagRunner) | undefined,
  extraDefinitions: ReturnType<typeof createCliNodeRegistry> = [],
  onComplete?: (record: IRunRecord) => void,
): Promise<CallToolResult> {
  const runner =
    createRunner !== undefined
      ? createRunner()
      : new LocalDagRunner([...createCliNodeRegistry(), ...extraDefinitions]);
  const startMs = Date.now();
  let result: import('../../local-runner/index.js').ILocalRunResult;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`DAG run timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });
    result = await Promise.race([runner.run(dag, inputs), timeoutPromise]);
  } catch (runErr) {
    // allow-fallback: execution errors are surfaced as structured MCP error results
    return makeTextResult(
      {
        ok: false,
        error: resolveErrorMessage(runErr),
        durationMs: Date.now() - startMs,
      },
      true,
    );
  }

  const durationMs = Date.now() - startMs;
  const outputs = collectOutputs(result);
  const nodeStatuses = result.taskRuns.map((tr) => ({ nodeId: tr.nodeId, status: tr.status }));

  onComplete?.({
    dagRunId: result.dagRun.dagRunId,
    dagId: dag.dagId,
    status: result.dagRun.status,
    completedAt: Date.now(),
    durationMs,
    nodeStatuses,
  });

  return makeTextResult({
    ok: result.dagRun.status === 'success',
    dagRunId: result.dagRun.dagRunId,
    durationMs,
    outputs,
    nodeStatuses,
  });
}

export async function handleDagRunDefinition(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
  sessionGate: import('../../session/session-gate.js').SessionPermissionGate | undefined,
): Promise<CallToolResult> {
  if (sessionGate) {
    const expiry = sessionGate.checkExpiry();
    if (expiry) return makeTextResult({ ok: false, error: expiry }, true);
  }

  const defResult = parseDefinitionArg(args, 'definition');
  if (!defResult.ok) return makeErrorResult(defResult.error);

  if (sessionGate) {
    const nodeTypes = defResult.value.nodes.map((n) => n.nodeType);
    const manifests = ctx.getManifests();
    const violation = sessionGate.checkNodeTypes(
      nodeTypes,
      manifests.map((m) => m.nodeType),
    );
    if (violation) return makeTextResult({ ok: false, error: violation }, true);
  }

  const inputs = (
    typeof args['inputs'] === 'object' && args['inputs'] !== null ? args['inputs'] : {}
  ) as TPortPayload;
  const timeoutMs =
    typeof args['timeoutMs'] === 'number' && Number.isFinite(args['timeoutMs'])
      ? (args['timeoutMs'] as number)
      : DEFAULT_TIMEOUT_MS;

  return runDagDefinition(
    defResult.value,
    inputs,
    timeoutMs,
    ctx.options.createRunner,
    ctx.instantNodeDefinitions,
    (record) => ctx.addCompletedRun(record),
  );
}

export async function handleDagRunFile(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const file = args['file'];
  if (typeof file !== 'string' || file.trim().length === 0) {
    return makeErrorResult('"file" is required');
  }

  let text: string;
  try {
    text = await readFile(file, UTF8_ENCODING);
  } catch (readErr) {
    // allow-fallback: file read error returned as MCP error result
    return makeErrorResult(`Failed to read file "${file}": ${resolveErrorMessage(readErr)}`);
  }

  let dag: IDagDefinition;
  try {
    dag = JSON.parse(text) as IDagDefinition;
  } catch (parseErr) {
    // allow-fallback: JSON parse error returned as MCP error result
    return makeErrorResult(`Failed to parse JSON from "${file}": ${resolveErrorMessage(parseErr)}`);
  }

  const inputs = (
    typeof args['inputs'] === 'object' && args['inputs'] !== null ? args['inputs'] : {}
  ) as TPortPayload;
  const timeoutMs =
    typeof args['timeoutMs'] === 'number' && Number.isFinite(args['timeoutMs'])
      ? (args['timeoutMs'] as number)
      : DEFAULT_TIMEOUT_MS;

  return runDagDefinition(dag, inputs, timeoutMs, ctx.options.createRunner);
}

export function handleDagRunsPollProgress(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): CallToolResult {
  const runId = args['runId'];
  if (typeof runId !== 'string' || runId.trim().length === 0) {
    return makeErrorResult('"runId" is required');
  }
  const record = ctx.getCompletedRun(runId.trim());
  if (!record) {
    return makeTextResult({
      runId: runId.trim(),
      status: 'not_found',
      message: 'No completed run found for this runId in the current session.',
    });
  }
  return makeTextResult({
    runId: record.dagRunId,
    status: record.status,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    nodes: record.nodeStatuses,
  });
}

export function handleDagRunsList(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): CallToolResult {
  const dagId = typeof args['dagId'] === 'string' ? args['dagId'] : undefined;
  const status = typeof args['status'] === 'string' ? args['status'] : undefined;
  const rawLimit = args['limit'];
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20;

  const runs = ctx.listCompletedRuns({ dagId, status, limit });
  return makeTextResult({
    runs,
    count: runs.length,
    _agentSummary:
      runs.length === 0
        ? 'No run history found. Runs are recorded when you execute DAGs via dag_run_definition.'
        : `Found ${runs.length} run(s).`,
  });
}

export function handleDagRunsCancel(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): CallToolResult {
  const runId = args['runId'];
  if (typeof runId !== 'string' || runId.trim().length === 0) {
    return makeErrorResult('"runId" is required');
  }
  const record = ctx.getCompletedRun(runId.trim());
  if (!record) {
    return makeTextResult(
      {
        ok: false,
        runId: runId.trim(),
        error: 'Run not found. In local mode, only completed runs are tracked.',
      },
      true,
    );
  }
  return makeTextResult({
    ok: true,
    runId: record.dagRunId,
    previousStatus: record.status,
    cancelledAt: Date.now(),
    message:
      'Local runs complete synchronously. Run was already finished when cancel was received.',
    partialResults: {
      completedNodes: record.nodeStatuses
        .filter((n) => n.status === 'success')
        .map((n) => n.nodeId),
      cancelledNodes: [],
    },
  });
}
