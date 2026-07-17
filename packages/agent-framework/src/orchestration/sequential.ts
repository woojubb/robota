import {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  composeEventName,
} from '@robota-sdk/agent-core';

import type {
  ISequentialOrchestrationSpec,
  IOrchestrationStep,
  IOrchestrationRunResult,
  IOrchestrationStepResult,
  IOrchestrationEventData,
  IEventService,
  IEventContext,
} from '@robota-sdk/agent-core';
import type { ISubagentManager, ISubagentSpawnRequest } from '@robota-sdk/agent-executor';

/**
 * Neutral run context threaded into each spawned subagent request.
 */
export interface ISequentialRunContext {
  /** The parent session id the run belongs to. */
  parentSessionId: string;
  /** The working directory for spawned subagents. */
  cwd: string;
  /** Depth of this orchestration in the hierarchy (0 = root). */
  depth?: number;
}

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
  context: ISequentialRunContext;
  /** Optional event service; when present, lifecycle events are emitted. */
  events?: IEventService;
}

function emit(
  events: IEventService | undefined,
  local: string,
  runId: string,
  data: Omit<IOrchestrationEventData, 'timestamp' | 'primitive'>,
): void {
  if (!events) return;
  const context: IEventContext = {
    ownerType: ORCHESTRATION_EVENT_PREFIX,
    ownerId: runId,
    ownerPath: [{ type: ORCHESTRATION_EVENT_PREFIX, id: runId }],
  };
  const payload: IOrchestrationEventData = {
    timestamp: new Date(),
    primitive: 'sequential',
    ...data,
  };
  events.emit(composeEventName(ORCHESTRATION_EVENT_PREFIX, local), payload, context);
}

/**
 * Run a `sequential` orchestration: execute each step in order over the injected
 * `ISubagentManager`, threading each step's output into the next (when
 * `threadOutput` is not disabled), and emitting neutral lifecycle events over the
 * event-service. Returns the per-step results plus the final aggregate output
 * (the last step's output).
 */
function buildStepRequest(
  step: IOrchestrationStep,
  context: ISequentialRunContext,
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

async function runStep(
  step: IOrchestrationStep,
  index: number,
  previousOutput: string,
  spec: ISequentialOrchestrationSpec,
  deps: ISequentialOrchestratorDeps,
  runId: string,
): Promise<IOrchestrationStepResult> {
  const { manager, context, events } = deps;
  emit(events, ORCHESTRATION_EVENTS.STEP_STARTED, runId, { stepId: step.id, stepIndex: index });

  const threadOutput = spec.threadOutput !== false;
  const prompt =
    threadOutput && previousOutput
      ? `${step.prompt}\n\n---\nPrevious step output:\n${previousOutput}`
      : step.prompt;

  const jobState = await manager.spawn(buildStepRequest(step, context, prompt));
  const result = await manager.wait(jobState.id);

  emit(events, ORCHESTRATION_EVENTS.STEP_COMPLETED, runId, { stepId: step.id, stepIndex: index });
  return { id: step.id, output: result.output, ...(result.usage ? { usage: result.usage } : {}) };
}

export async function runSequential(
  spec: ISequentialOrchestrationSpec,
  deps: ISequentialOrchestratorDeps,
): Promise<IOrchestrationRunResult> {
  const runId = `${deps.context.parentSessionId}:seq`;
  emit(deps.events, ORCHESTRATION_EVENTS.STARTED, runId, {});

  const stepResults: IOrchestrationStepResult[] = [];
  let previousOutput = '';

  try {
    for (let index = 0; index < spec.steps.length; index += 1) {
      const stepResult = await runStep(spec.steps[index], index, previousOutput, spec, deps, runId);
      stepResults.push(stepResult);
      previousOutput = stepResult.output;
    }
  } catch (error) {
    emit(deps.events, ORCHESTRATION_EVENTS.FAILED, runId, {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  emit(deps.events, ORCHESTRATION_EVENTS.COMPLETED, runId, {});
  return { primitive: 'sequential', steps: stepResults, output: previousOutput };
}
