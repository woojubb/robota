/**
 * MCP-004 §S1 — the `tool-invocation` background-task runner.
 *
 * Every other runner in this directory STARTS work when `start()` is called. This one does not: the
 * work is already running in the foreground (an MCP tool call the wrapper, `agent-framework` S3,
 * decided to hand off past a threshold) by the time `manager.spawn()` is even called. The runner
 * instead ADOPTS it — `adopt()` registers the in-flight promise and its abort under a token BEFORE
 * `spawn()` runs, and `start()`'s only job is to look that token up.
 *
 * The runner declares `admission: 'already-running'` on the SPI so `BackgroundTaskManager.spawn`
 * starts it directly, bypassing the queue and the concurrency slot (`background-task-manager.ts`) —
 * the work already runs outside any manager-provisioned resource, so queuing it would only delay
 * `cancel()` from ever reaching the live call.
 *
 * The adoption registry is owned by the RETURNED INSTANCE, never a module-level singleton: two
 * runners from two calls to the factory (two managers, or a test and the product side by side) never
 * share a token namespace.
 */

import { BackgroundTaskError } from './types.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IToolInvocationAdopter,
  IToolInvocationBackgroundTaskRequest,
} from './types.js';
import type { IToolResult } from '@robota-sdk/agent-core';

/** The work an adopted call carries: its eventual settlement, and how to abort the live call. */
interface IAdoptedToolInvocation {
  settled: Promise<IToolResult>;
  abort(reason: string): void;
}

/**
 * The background task's `output` text, derived exactly as `discovered-tool.ts` derives a tool's own
 * text from its result: a string result rides as-is; anything else is serialized. Only text survives
 * the handoff — `structuredContent` (a tool's `data` when it is not already a string) does not.
 */
function deriveOutputText(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data ?? null);
}

function requireToolInvocationRequest(
  task: IBackgroundTaskStart<'tool-invocation'>,
): IToolInvocationBackgroundTaskRequest {
  if (task.request.kind !== 'tool-invocation') {
    throw new BackgroundTaskError(
      'runner',
      `Invalid tool-invocation task kind: ${task.request.kind}`,
    );
  }
  return task.request;
}

function startAdoptedTask(
  taskId: string,
  toolName: string,
  work: IAdoptedToolInvocation,
): IBackgroundTaskHandle {
  const result: Promise<IBackgroundTaskResult> = work.settled.then(
    (toolResult) => ({
      taskId,
      kind: 'tool-invocation',
      output: deriveOutputText(toolResult.data),
    }),
    (error: unknown) => {
      throw new BackgroundTaskError(
        'runner',
        error instanceof Error ? error.message : String(error),
        false,
      );
    },
  );

  return {
    taskId,
    result,
    cancel: async (reason?: string) => {
      work.abort(reason ?? `Background task cancelled: ${toolName}`);
    },
  };
}

/**
 * Builds the `tool-invocation` runner. The returned value satisfies both `IBackgroundTaskRunner`
 * (what `createDefaultBackgroundTaskRunners()` registers) and `IToolInvocationAdopter` (the port the
 * wrapper narrows to by `'adopt' in runner`, the sibling of `buildBackgroundProcessTool`'s
 * `hasProcessRunner` check).
 */
export function createToolInvocationBackgroundTaskRunner(): IBackgroundTaskRunner<'tool-invocation'> &
  IToolInvocationAdopter {
  const registry = new Map<string, IAdoptedToolInvocation>();

  return {
    kind: 'tool-invocation',
    admission: 'already-running',

    adopt(token: string, work: IAdoptedToolInvocation): () => void {
      registry.set(token, work);
      return () => {
        registry.delete(token);
      };
    },

    start(task: IBackgroundTaskStart<'tool-invocation'>): IBackgroundTaskHandle {
      const request = requireToolInvocationRequest(task);
      const work = registry.get(request.adoptionToken);
      if (!work) {
        // A programmer-error refusal, not the restart path: a `tool-invocation` request always
        // arrives with a token `adopt()` already holds (the wrapper adopts before it spawns). A
        // missing token means the caller spawned without adopting first.
        throw new BackgroundTaskError(
          'validation',
          `No adopted tool invocation for token: ${request.adoptionToken}`,
        );
      }
      registry.delete(request.adoptionToken);
      return startAdoptedTask(task.taskId, request.toolName, work);
    },
  };
}
