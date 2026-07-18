import {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  composeEventName,
} from '@robota-sdk/agent-core';

import type {
  IOrchestrationStep,
  IOrchestrationStepResult,
  IOrchestrationEventData,
  IEventService,
  IEventContext,
  TOrchestrationPrimitive,
} from '@robota-sdk/agent-core';
import type { ISubagentManager, ISubagentSpawnRequest } from '@robota-sdk/agent-executor';

/**
 * Neutral run context threaded into each spawned subagent request. Shared by
 * every orchestration primitive (`sequential`/`parallel`/`handoff`/…).
 */
export interface IOrchestrationRunContext {
  /** The parent session id the run belongs to. */
  parentSessionId: string;
  /** The working directory for spawned subagents. */
  cwd: string;
  /** Depth of this orchestration in the hierarchy (0 = root). */
  depth?: number;
}

/** The minimal dependency surface a single step needs to spawn + wait. */
export interface IStepRunDeps {
  /** The subagent manager (over `ISubagentRunner`) that runs the step. */
  manager: ISubagentManager;
  /** Run context threaded into the spawned subagent request. */
  context: IOrchestrationRunContext;
}

/** Build the subagent spawn request for a step, honoring per-step model/tool scoping. */
function buildStepRequest(
  step: IOrchestrationStep,
  context: IOrchestrationRunContext,
  prompt: string,
): ISubagentSpawnRequest {
  return {
    type: step.agentType,
    label: step.label,
    parentSessionId: context.parentSessionId,
    mode: 'foreground',
    depth: context.depth ?? 0,
    cwd: context.cwd,
    prompt,
    ...(step.model ? { model: step.model } : {}),
    ...(step.allowedTools ? { allowedTools: step.allowedTools } : {}),
    ...(step.disallowedTools ? { disallowedTools: step.disallowedTools } : {}),
  };
}

/** Augment a step's prompt with the previous output so results thread forward. */
export function threadPrompt(basePrompt: string, previousOutput: string): string {
  return previousOutput
    ? `${basePrompt}\n\n---\nPrevious step output:\n${previousOutput}`
    : basePrompt;
}

/** A bound emitter that stamps every payload with a fixed primitive + a run id. */
export type OrchestrationEmit = (
  local: string,
  runId: string,
  data: Omit<IOrchestrationEventData, 'timestamp' | 'primitive'>,
) => void;

/** Build the neutral lifecycle-event emitter for a primitive (no-op when no event service). */
export function makeEmit(
  events: IEventService | undefined,
  primitive: TOrchestrationPrimitive,
): OrchestrationEmit {
  return (local, runId, data) => {
    if (!events) return;
    const context: IEventContext = {
      ownerType: ORCHESTRATION_EVENT_PREFIX,
      ownerId: runId,
      ownerPath: [{ type: ORCHESTRATION_EVENT_PREFIX, id: runId }],
    };
    const payload: IOrchestrationEventData = { timestamp: new Date(), primitive, ...data };
    events.emit(composeEventName(ORCHESTRATION_EVENT_PREFIX, local), payload, context);
  };
}

/**
 * Run one step: emit STEP_STARTED, spawn + wait over the manager, emit
 * STEP_COMPLETED, and return the neutral step result. Shared by every primitive
 * so the spawn/wait/event mechanics live in exactly one place.
 */
export async function runStepOnce(
  step: IOrchestrationStep,
  index: number,
  prompt: string,
  deps: IStepRunDeps,
  runId: string,
  emit: OrchestrationEmit,
): Promise<IOrchestrationStepResult> {
  emit(ORCHESTRATION_EVENTS.STEP_STARTED, runId, { stepId: step.id, stepIndex: index });
  const jobState = await deps.manager.spawn(buildStepRequest(step, deps.context, prompt));
  const result = await deps.manager.wait(jobState.id);
  emit(ORCHESTRATION_EVENTS.STEP_COMPLETED, runId, { stepId: step.id, stepIndex: index });
  return { id: step.id, output: result.output, ...(result.usage ? { usage: result.usage } : {}) };
}
