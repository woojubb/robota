import { ORCHESTRATION_EVENTS } from '@robota-sdk/agent-core';

import { makeEmit, runStepOnce, threadPrompt, type IOrchestrationRunContext } from './shared';

import type {
  IGroupChatOrchestrationSpec,
  IOrchestrationStep,
  IOrchestrationRunResult,
  IOrchestrationStepResult,
  IEventService,
} from '@robota-sdk/agent-core';
import type { ISubagentManager } from '@robota-sdk/agent-executor';

/**
 * A neutral turn-selection policy: given the running history and the id of the
 * step that just took a turn, return the id of the step to take the next turn,
 * or `null` to end. Keeping WHO speaks next a caller decision means the
 * primitive itself carries no app-domain turn logic (library-neutral).
 */
export type SelectNextStep = (
  history: IOrchestrationStepResult[],
  lastStepId: string,
) => string | null;

/**
 * Dependencies for the `group-chat` orchestration mechanism. Adds the neutral
 * `selectNextStep` policy to the shared manager/context/events surface.
 */
export interface IGroupChatOrchestratorDeps {
  /** The subagent manager (over `ISubagentRunner`) that runs each step. */
  manager: ISubagentManager;
  /** Run context threaded into each spawned subagent request. */
  context: IOrchestrationRunContext;
  /** Optional event service; when present, lifecycle events are emitted. */
  events?: IEventService;
  /** Caller-supplied policy selecting the next step to take a turn (or `null` to end). */
  selectNextStep: SelectNextStep;
}

/** Monotonic per-process counter so concurrent runs in one session get distinct run ids. */
let groupChatRunCounter = 0;

/** Render the prior turns as neutral, id-labeled history threaded into the next step. */
function renderHistory(stepResults: IOrchestrationStepResult[]): string {
  return stepResults.map((result) => `[${result.id}] ${result.output}`).join('\n\n');
}

/**
 * Run a `group-chat` (turn-taking) orchestration: starting at `firstStepId` (or
 * the first step), each selected step takes a turn — threaded the prior turns'
 * outputs — then the injected `selectNextStep` policy picks who goes next, `null`
 * ending the run. A `maxTurns` bound (default: step count) guards a policy that
 * never ends; exceeding it fails the run. Returns the per-step results in turn
 * order plus the last turn's output. Emits neutral lifecycle events.
 */
export async function runGroupChat(
  spec: IGroupChatOrchestrationSpec,
  deps: IGroupChatOrchestratorDeps,
): Promise<IOrchestrationRunResult> {
  groupChatRunCounter += 1;
  const runId = `${deps.context.parentSessionId}:groupchat:${groupChatRunCounter}`;
  const emit = makeEmit(deps.events, 'group-chat');
  emit(ORCHESTRATION_EVENTS.STARTED, runId, {});

  const byId = new Map<string, IOrchestrationStep>(spec.steps.map((step) => [step.id, step]));
  const maxTurns = spec.maxTurns ?? spec.steps.length;
  const stepResults: IOrchestrationStepResult[] = [];
  let currentId: string | null = spec.firstStepId ?? spec.steps[0]?.id ?? null;

  try {
    while (currentId) {
      if (stepResults.length >= maxTurns) {
        throw new Error(`group-chat exceeded maxTurns (${maxTurns})`);
      }
      const step = byId.get(currentId);
      if (!step) throw new Error(`group-chat step not found: ${currentId}`);
      const prompt = threadPrompt(step.prompt, renderHistory(stepResults));
      const result = await runStepOnce(step, stepResults.length, prompt, deps, runId, emit);
      stepResults.push(result);
      currentId = deps.selectNextStep(stepResults, step.id);
    }
  } catch (error) {
    emit(ORCHESTRATION_EVENTS.FAILED, runId, {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  emit(ORCHESTRATION_EVENTS.COMPLETED, runId, {});
  const output = stepResults.length > 0 ? stepResults[stepResults.length - 1].output : '';
  return { primitive: 'group-chat', steps: stepResults, output };
}
