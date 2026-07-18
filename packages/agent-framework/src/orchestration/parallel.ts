import { ORCHESTRATION_EVENTS } from '@robota-sdk/agent-core';

import { makeEmit, runStepOnce, type IOrchestrationRunContext } from './shared';

import type {
  IParallelOrchestrationSpec,
  IOrchestrationRunResult,
  IOrchestrationStepResult,
  IEventService,
} from '@robota-sdk/agent-core';
import type { ISubagentManager } from '@robota-sdk/agent-executor';

/**
 * Dependencies for the `parallel` orchestration mechanism. Same shape as the
 * sequential deps — the injected `ISubagentManager` (over `ISubagentRunner`)
 * runs each step; the framework never depends on `agent-subagent-runner`.
 */
export interface IParallelOrchestratorDeps {
  /** The subagent manager (over `ISubagentRunner`) that runs each step. */
  manager: ISubagentManager;
  /** Run context threaded into each spawned subagent request. */
  context: IOrchestrationRunContext;
  /** Optional event service; when present, lifecycle events are emitted. */
  events?: IEventService;
}

/** Monotonic per-process counter so concurrent runs in one session get distinct run ids. */
let parallelRunCounter = 0;

/**
 * Run a `parallel` orchestration: execute the steps concurrently over the
 * injected `ISubagentManager` under a bounded concurrency pool
 * (`maxConcurrency`; unbounded when omitted or `<= 0`), then aggregate. Each
 * step runs with only its own prompt (no threading). Results are returned in
 * original step order regardless of completion order; the aggregate output is
 * every step's output joined in order (blank-line separated). Emits neutral
 * lifecycle events over the event-service; step events interleave by nature.
 */
export async function runParallel(
  spec: IParallelOrchestrationSpec,
  deps: IParallelOrchestratorDeps,
): Promise<IOrchestrationRunResult> {
  parallelRunCounter += 1;
  const runId = `${deps.context.parentSessionId}:par:${parallelRunCounter}`;
  const emit = makeEmit(deps.events, 'parallel');
  emit(ORCHESTRATION_EVENTS.STARTED, runId, {});

  const results = new Array<IOrchestrationStepResult>(spec.steps.length);
  const bound =
    spec.maxConcurrency && spec.maxConcurrency > 0 ? spec.maxConcurrency : spec.steps.length;
  const poolSize = Math.max(1, Math.min(bound, spec.steps.length));
  let nextIndex = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    for (;;) {
      // Fail-fast: once any sibling has thrown, stop pulling new steps so an
      // early failure does not keep spawning the rest of the queue.
      if (aborted) return;
      const index = nextIndex++;
      if (index >= spec.steps.length) return;
      const step = spec.steps[index];
      try {
        results[index] = await runStepOnce(step, index, step.prompt, deps, runId, emit);
      } catch (error) {
        aborted = true;
        throw error;
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
  } catch (error) {
    emit(ORCHESTRATION_EVENTS.FAILED, runId, {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  emit(ORCHESTRATION_EVENTS.COMPLETED, runId, {});
  const output = results.map((result) => result.output).join('\n\n');
  return { primitive: 'parallel', steps: results, output };
}
