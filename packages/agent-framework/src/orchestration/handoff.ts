import { ORCHESTRATION_EVENTS } from '@robota-sdk/agent-core';

import { makeEmit, runStepOnce, threadPrompt, type IOrchestrationRunContext } from './shared';

import type {
  IHandoffOrchestrationSpec,
  IOrchestrationStep,
  IOrchestrationRunResult,
  IOrchestrationStepResult,
  IEventService,
} from '@robota-sdk/agent-core';
import type { ISubagentManager } from '@robota-sdk/agent-executor';

/**
 * A neutral handoff policy: given the current step's output and id, return the
 * id of the step to transfer control to, or `null` to stop. This is the ONLY
 * injected policy — keeping WHICH step receives control a caller decision means
 * the primitive itself carries no app-domain routing logic (library-neutral).
 */
export type ResolveHandoff = (output: string, currentStepId: string) => string | null;

/**
 * Dependencies for the `handoff` orchestration mechanism. Adds the neutral
 * `resolveHandoff` policy to the shared manager/context/events surface.
 */
export interface IHandoffOrchestratorDeps {
  /** The subagent manager (over `ISubagentRunner`) that runs each step. */
  manager: ISubagentManager;
  /** Run context threaded into each spawned subagent request. */
  context: IOrchestrationRunContext;
  /** Optional event service; when present, lifecycle events are emitted. */
  events?: IEventService;
  /** Caller-supplied policy resolving the next step to transfer control to (or `null` to stop). */
  resolveHandoff: ResolveHandoff;
}

/** Monotonic per-process counter so concurrent runs in one session get distinct run ids. */
let handoffRunCounter = 0;

/**
 * Run a `handoff` orchestration: control starts at `entryStepId`; after each
 * step the injected `resolveHandoff` policy decides which step (if any) receives
 * control next, transferring loop ownership. The receiving step is threaded the
 * previous step's output. A `maxHandoffs` bound (default: step count) guards a
 * policy that never terminates. Returns the per-step results in execution order
 * plus the final control-holder's output. Emits neutral lifecycle events.
 */
export async function runHandoff(
  spec: IHandoffOrchestrationSpec,
  deps: IHandoffOrchestratorDeps,
): Promise<IOrchestrationRunResult> {
  handoffRunCounter += 1;
  const runId = `${deps.context.parentSessionId}:handoff:${handoffRunCounter}`;
  const emit = makeEmit(deps.events, 'handoff');
  emit(ORCHESTRATION_EVENTS.STARTED, runId, {});

  const byId = new Map<string, IOrchestrationStep>(spec.steps.map((step) => [step.id, step]));
  const maxHandoffs = spec.maxHandoffs ?? spec.steps.length;
  const stepResults: IOrchestrationStepResult[] = [];
  let currentId: string | null = spec.entryStepId;
  let previousOutput = '';
  let transfers = 0;

  try {
    while (currentId) {
      const step = byId.get(currentId);
      if (!step) throw new Error(`handoff target step not found: ${currentId}`);
      const index = stepResults.length;
      const result = await runStepOnce(
        step,
        index,
        threadPrompt(step.prompt, previousOutput),
        deps,
        runId,
        emit,
      );
      stepResults.push(result);
      previousOutput = result.output;

      const next = deps.resolveHandoff(result.output, step.id);
      if (!next) break;
      transfers += 1;
      if (transfers > maxHandoffs) {
        throw new Error(`handoff exceeded maxHandoffs (${maxHandoffs})`);
      }
      currentId = next;
    }
  } catch (error) {
    emit(ORCHESTRATION_EVENTS.FAILED, runId, {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  emit(ORCHESTRATION_EVENTS.COMPLETED, runId, {});
  return { primitive: 'handoff', steps: stepResults, output: previousOutput };
}
