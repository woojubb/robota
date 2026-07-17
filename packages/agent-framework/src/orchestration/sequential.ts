import { ORCHESTRATION_EVENTS } from '@robota-sdk/agent-core';

import { makeEmit, runStepOnce, threadPrompt, type IOrchestrationRunContext } from './shared';

import type {
  ISequentialOrchestrationSpec,
  IOrchestrationStep,
  IOrchestrationRunResult,
  IOrchestrationStepResult,
  IEventService,
} from '@robota-sdk/agent-core';
import type { ISubagentManager } from '@robota-sdk/agent-executor';

/**
 * Neutral run context threaded into each spawned subagent request.
 * Alias of the shared {@link IOrchestrationRunContext}, kept as the
 * sequential-specific public name for back-compat.
 */
export type ISequentialRunContext = IOrchestrationRunContext;

/**
 * Dependencies for the `sequential` orchestration mechanism.
 *
 * The `manager` is the `agent-executor` `ISubagentManager` — the port surface
 * over `ISubagentRunner`. At the composition root it is built over the real
 * runner (`createInProcessSubagentRunner` in-process, or the child-process
 * runner from `agent-subagent-runner` injected at the `agent-cli` root). The
 * framework NEVER depends on `agent-subagent-runner` (that would be a cycle);
 * it composes only over the injected `ISubagentManager`.
 */
export interface ISequentialOrchestratorDeps {
  /** The subagent manager (over `ISubagentRunner`) that runs each step. */
  manager: ISubagentManager;
  /** Run context threaded into each spawned subagent request. */
  context: IOrchestrationRunContext;
  /** Optional event service; when present, lifecycle events are emitted. */
  events?: IEventService;
}

async function runStep(
  step: IOrchestrationStep,
  index: number,
  previousOutput: string,
  spec: ISequentialOrchestrationSpec,
  deps: ISequentialOrchestratorDeps,
  runId: string,
  emit: ReturnType<typeof makeEmit>,
): Promise<IOrchestrationStepResult> {
  const threadOutput = spec.threadOutput !== false;
  const prompt = threadOutput ? threadPrompt(step.prompt, previousOutput) : step.prompt;
  return runStepOnce(step, index, prompt, deps, runId, emit);
}

/** Monotonic per-process counter so concurrent runs in one session get distinct run ids. */
let sequentialRunCounter = 0;

/**
 * Run a `sequential` orchestration: execute each step in order over the injected
 * `ISubagentManager`, threading each step's output into the next (when
 * `threadOutput` is not disabled), and emitting neutral lifecycle events over the
 * event-service. Returns the per-step results plus the final aggregate output
 * (the last step's output).
 */
export async function runSequential(
  spec: ISequentialOrchestrationSpec,
  deps: ISequentialOrchestratorDeps,
): Promise<IOrchestrationRunResult> {
  sequentialRunCounter += 1;
  const runId = `${deps.context.parentSessionId}:seq:${sequentialRunCounter}`;
  const emit = makeEmit(deps.events, 'sequential');
  emit(ORCHESTRATION_EVENTS.STARTED, runId, {});

  const stepResults: IOrchestrationStepResult[] = [];
  let previousOutput = '';

  try {
    for (let index = 0; index < spec.steps.length; index += 1) {
      const stepResult = await runStep(
        spec.steps[index],
        index,
        previousOutput,
        spec,
        deps,
        runId,
        emit,
      );
      stepResults.push(stepResult);
      previousOutput = stepResult.output;
    }
  } catch (error) {
    emit(ORCHESTRATION_EVENTS.FAILED, runId, {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  emit(ORCHESTRATION_EVENTS.COMPLETED, runId, {});
  return { primitive: 'sequential', steps: stepResults, output: previousOutput };
}
