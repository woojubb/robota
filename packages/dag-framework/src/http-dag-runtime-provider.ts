// HTTP runtime provider: drives a remote native DAG runtime server (apps/dag-runtime-server) over its
// `/v1/dag/*` surface. The first implementation of `IDetachableRunProvider` — submit a run, watch its
// progress over the SSE stream, query status, and read the final result. Mirrors LocalDagRuntimeProvider
// behaviour via the shared run-result mapping (no per-provider drift).

import { fromDagWorkflowFile } from '@robota-sdk/dag-builder';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';

import { isTerminalStatus, mapRunToResult } from './run-result-mapping.js';

import type {
  IDagNodeManifest,
  IDagRun,
  IDagRunStatus,
  IDagRuntimeExecuteOptions,
  IDagRunSummary,
  IDagRuntimeProgressEvent,
  IDagRuntimeResult,
  IDagWorkflowFile,
  IDetachableRunProvider,
  IListRunsOptions,
  ITaskRun,
  TDagRunStatus,
  TPortPayload,
  TRunPhase,
  TRunProgressEvent,
} from '@robota-sdk/dag-core';

export interface IHttpDagRuntimeProviderOptions {
  /** Base URL of the native DAG runtime server, e.g. `http://localhost:3939`. */
  readonly baseUrl: string;
  /** Fetch implementation (defaults to the global `fetch`); injectable for tests. */
  readonly fetch?: typeof fetch;
}

interface IRunDataPayload {
  readonly data?: {
    readonly dagRunId?: string;
    readonly dagRun?: IDagRun;
    readonly taskRuns?: ITaskRun[];
    readonly items?: IDagNodeManifest[];
  };
}

/** Delay between run-status polls while watching a run for terminal completion. */
const TERMINAL_POLL_INTERVAL_MS = 50;

/** Map a persisted DAG run status to the runtime-provider lifecycle phase. */
function toRunPhase(status: TDagRunStatus): TRunPhase {
  if (status === 'success') return 'completed';
  if (status === 'created') return 'queued';
  return status;
}

/** Resolve after `ms`, or early if the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Parse a single SSE frame (`event: <name>\ndata: <json>`) into its event name + data payload. */
function parseSseFrame(frame: string): { event: string; data: string } | undefined {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return undefined;
  return { event, data: dataLines.join('\n') };
}

/** Translate a server run-progress event into the runtime-provider progress contract. */
function emitRuntimeProgress(
  event: TRunProgressEvent,
  onProgress: (event: IDagRuntimeProgressEvent) => void,
  startTimes: Map<string, number>,
): void {
  if (event.eventType === 'task.started') {
    startTimes.set(event.nodeId, Date.now());
    onProgress({ type: 'node_start', nodeId: event.nodeId });
  } else if (event.eventType === 'task.completed') {
    const startedAt = startTimes.get(event.nodeId);
    onProgress({
      type: 'node_complete',
      nodeId: event.nodeId,
      durationMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
    });
  } else if (event.eventType === 'task.failed') {
    const startedAt = startTimes.get(event.nodeId);
    onProgress({
      type: 'node_error',
      nodeId: event.nodeId,
      durationMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
      error: event.error.message ?? event.error.code,
    });
  }
}

export class HttpDagRuntimeProvider implements IDetachableRunProvider {
  public readonly providerId = 'http';
  public readonly displayName: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly client: DagOrchestrationHttpClient;

  public constructor(options: IHttpDagRuntimeProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.displayName = `HTTP (${this.baseUrl})`;
    this.client = new DagOrchestrationHttpClient({ baseUrl: this.baseUrl, fetch: this.fetchImpl });
  }

  public async listNodes(): Promise<IDagNodeManifest[]> {
    const response = await this.client.listNodes();
    if (!response.ok) {
      throw new Error(`listNodes failed (HTTP ${response.status})`);
    }
    return (response.payload as IRunDataPayload).data?.items ?? [];
  }

  public async execute(
    dag: IDagWorkflowFile,
    inputs: Record<string, unknown>,
    options?: IDagRuntimeExecuteOptions,
  ): Promise<IDagRuntimeResult> {
    const runId = await this.submitRun(dag, inputs);
    return this.watchRun(runId, options?.onProgress ?? (() => undefined), options?.signal);
  }

  public async submitRun(dag: IDagWorkflowFile, inputs: Record<string, unknown>): Promise<string> {
    const definition = fromDagWorkflowFile(dag);
    const created = await this.client.createRun({ definition, input: inputs as TPortPayload });
    if (!created.ok) {
      throw new Error(`createRun failed (HTTP ${created.status})`);
    }
    const dagRunId = (created.payload as IRunDataPayload).data?.dagRunId;
    if (dagRunId === undefined) {
      throw new Error('createRun did not return a dagRunId');
    }
    const started = await this.client.startRun(dagRunId);
    if (!started.ok) {
      throw new Error(`startRun failed (HTTP ${started.status})`);
    }
    return dagRunId;
  }

  public async watchRun(
    runId: string,
    onProgress: (event: IDagRuntimeProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<IDagRuntimeResult> {
    const startMs = Date.now();
    // The progress bus is live-only: a run that finished before we subscribe emits no terminal event,
    // so the stream alone could hang. Race the live stream against a terminal-status poll — whichever
    // observes completion first wins, then abort the loser. This makes attaching to an already-finished
    // run (the detachable-run reconnect case) safe.
    const watchAbort = new AbortController();
    const forwardAbort = (): void => watchAbort.abort();
    if (signal?.aborted) watchAbort.abort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      await Promise.race([
        this.consumeProgressStream(runId, onProgress, watchAbort.signal),
        this.pollUntilTerminal(runId, watchAbort.signal),
      ]);
    } finally {
      watchAbort.abort();
      signal?.removeEventListener('abort', forwardAbort);
    }

    const result = await this.client.getRunResult(runId);
    if (!result.ok) {
      throw new Error(`getRunResult failed (HTTP ${result.status})`);
    }
    const data = (result.payload as IRunDataPayload).data;
    if (data?.dagRun === undefined) {
      throw new Error('getRunResult response did not include the run state');
    }
    return mapRunToResult(data.dagRun, data.taskRuns ?? [], Date.now() - startMs);
  }

  public async getRunStatus(runId: string): Promise<IDagRunStatus> {
    const response = await this.client.getRunStatus(runId);
    if (!response.ok) {
      throw new Error(`getRunStatus failed (HTTP ${response.status})`);
    }
    const dagRun = (response.payload as IRunDataPayload).data?.dagRun;
    if (dagRun === undefined) {
      throw new Error('getRunStatus response did not include the run state');
    }
    const status: IDagRunStatus = { runId, phase: toRunPhase(dagRun.status) };
    if (dagRun.startedAt !== undefined) status.startedAt = dagRun.startedAt;
    if (isTerminalStatus(dagRun.status)) {
      const taskRuns = (response.payload as IRunDataPayload).data?.taskRuns ?? [];
      status.result = mapRunToResult(dagRun, taskRuns, 0);
    }
    return status;
  }

  public cancelRun(_runId: string): Promise<void> {
    // The orchestration surface exposes no run-cancel endpoint yet; surface that plainly rather than
    // pretend success.
    return Promise.reject(
      new Error(
        'cancelRun is not supported by the HTTP runtime provider (no server cancel endpoint)',
      ),
    );
  }

  public listRuns(_options?: IListRunsOptions): Promise<IDagRunSummary[]> {
    // The orchestration surface exposes no run-listing endpoint yet; surface that plainly rather
    // than return an empty list that would read as "no runs exist".
    return Promise.reject(
      new Error(
        'listRuns is not supported by the HTTP runtime provider (no server run-listing endpoint)',
      ),
    );
  }

  /** Poll the run's status until it reaches a terminal state (or the watch is aborted). */
  private async pollUntilTerminal(runId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const response = await this.client.getRunStatus(runId);
      if (response.ok) {
        const dagRun = (response.payload as IRunDataPayload).data?.dagRun;
        if (dagRun !== undefined && isTerminalStatus(dagRun.status)) return;
      }
      await delay(TERMINAL_POLL_INTERVAL_MS, signal);
    }
  }

  /** Consume the run's SSE progress stream until it closes (terminal event or abort). */
  private async consumeProgressStream(
    runId: string,
    onProgress: (event: IDagRuntimeProgressEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/dag/runs/${encodeURIComponent(runId)}/events`,
      {
        signal,
      },
    );
    // No stream available (e.g. 501): the caller still reads the final result via getRunResult.
    if (!response.ok || response.body === null) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const startTimes = new Map<string, number>();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.indexOf('\n\n');
        while (separator !== -1) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const parsed = parseSseFrame(frame);
          if (parsed !== undefined && parsed.event !== 'open') {
            emitRuntimeProgress(
              JSON.parse(parsed.data) as TRunProgressEvent,
              onProgress,
              startTimes,
            );
          }
          separator = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      // allow-fallback: an abort is the normal stop signal once the terminal state is observed
      // out-of-band (the polling branch won the race); only non-abort errors are real failures.
      if (signal.aborted) return;
      throw err;
    }
  }
}
