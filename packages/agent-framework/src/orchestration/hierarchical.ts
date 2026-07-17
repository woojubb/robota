import { ORCHESTRATION_EVENTS } from '@robota-sdk/agent-core';

import {
  makeEmit,
  runStepOnce,
  threadPrompt,
  type OrchestrationEmit,
  type IStepRunDeps,
  type IOrchestrationRunContext,
} from './shared';

import type {
  IHierarchicalOrchestrationSpec,
  IOrchestrationDelegation,
  IOrchestrationStep,
  IOrchestrationRunResult,
  IOrchestrationStepResult,
  IEventService,
} from '@robota-sdk/agent-core';
import type { ISubagentManager } from '@robota-sdk/agent-executor';

/**
 * A neutral delegation policy: given the manager step's latest output and the
 * current round, return the worker delegations to run next, or an empty
 * array / `null` to finish. Keeping WHICH workers run a caller decision means
 * the primitive itself carries no app-domain routing (library-neutral).
 */
export type PlanDelegation = (
  managerOutput: string,
  round: number,
) => IOrchestrationDelegation[] | null;

/**
 * Dependencies for the `hierarchical` orchestration mechanism. Adds the neutral
 * `planDelegation` policy to the shared manager/context/events surface.
 */
export interface IHierarchicalOrchestratorDeps {
  /** The subagent manager (over `ISubagentRunner`) that runs each step. */
  manager: ISubagentManager;
  /** Run context threaded into each spawned subagent request. */
  context: IOrchestrationRunContext;
  /** Optional event service; when present, lifecycle events are emitted. */
  events?: IEventService;
  /** Caller-supplied policy turning the manager's output into worker delegations (or `null` to stop). */
  planDelegation: PlanDelegation;
}

/** Monotonic per-process counter so concurrent runs in one session get distinct run ids. */
let hierarchicalRunCounter = 0;

/** Run every delegated worker in order, pushing each result and returning the aggregated output. */
async function runDelegations(
  plan: IOrchestrationDelegation[],
  byId: Map<string, IOrchestrationStep>,
  stepResults: IOrchestrationStepResult[],
  deps: IStepRunDeps,
  runId: string,
  emit: OrchestrationEmit,
): Promise<string> {
  const outputs: string[] = [];
  for (const delegation of plan) {
    const worker = byId.get(delegation.stepId);
    if (!worker) throw new Error(`hierarchical delegated to unknown step: ${delegation.stepId}`);
    const result = await runStepOnce(
      worker,
      stepResults.length,
      delegation.prompt,
      deps,
      runId,
      emit,
    );
    stepResults.push(result);
    outputs.push(`[${worker.id}] ${result.output}`);
  }
  return outputs.join('\n\n');
}

/**
 * Run a `hierarchical` (manager-delegation) orchestration: the manager step runs
 * (threaded the previous round's aggregated worker output), the injected
 * `planDelegation` policy turns its output into worker delegations, those workers
 * run, and their aggregated output feeds the manager's next round — until the
 * policy returns an empty/`null` plan (the manager is done) or `maxRounds` is
 * exceeded. Returns the per-step results in execution order plus the manager's
 * final output. Emits neutral lifecycle events over the event-service.
 */
export async function runHierarchical(
  spec: IHierarchicalOrchestrationSpec,
  deps: IHierarchicalOrchestratorDeps,
): Promise<IOrchestrationRunResult> {
  hierarchicalRunCounter += 1;
  const runId = `${deps.context.parentSessionId}:hier:${hierarchicalRunCounter}`;
  const emit = makeEmit(deps.events, 'hierarchical');
  emit(ORCHESTRATION_EVENTS.STARTED, runId, {});

  const byId = new Map<string, IOrchestrationStep>(spec.steps.map((step) => [step.id, step]));
  const managerStep = byId.get(spec.managerStepId);
  if (!managerStep) {
    emit(ORCHESTRATION_EVENTS.FAILED, runId, { reason: 'manager step not found' });
    throw new Error(`hierarchical manager step not found: ${spec.managerStepId}`);
  }
  const maxRounds = spec.maxRounds ?? spec.steps.length;
  const stepResults: IOrchestrationStepResult[] = [];
  let workerContext = '';
  let managerOutput = '';
  let round = 0;

  try {
    for (;;) {
      const prompt = threadPrompt(managerStep.prompt, workerContext);
      const result = await runStepOnce(managerStep, stepResults.length, prompt, deps, runId, emit);
      stepResults.push(result);
      managerOutput = result.output;

      const plan = deps.planDelegation(managerOutput, round);
      if (!plan || plan.length === 0) break;
      round += 1;
      if (round > maxRounds) throw new Error(`hierarchical exceeded maxRounds (${maxRounds})`);
      workerContext = await runDelegations(plan, byId, stepResults, deps, runId, emit);
    }
  } catch (error) {
    emit(ORCHESTRATION_EVENTS.FAILED, runId, {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  emit(ORCHESTRATION_EVENTS.COMPLETED, runId, {});
  return { primitive: 'hierarchical', steps: stepResults, output: managerOutput };
}
