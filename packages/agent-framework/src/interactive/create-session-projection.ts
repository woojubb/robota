import { FileSessionLogger } from '@robota-sdk/agent-session';

import { NOOP_TERMINAL } from './interactive-session-execution.js';

import type { IInitOptions } from './interactive-session-options.js';
import type { ICreateSessionOptions } from '../assembly/index.js';

/**
 * The single place `IInitOptions` becomes `ICreateSessionOptions`.
 *
 * ARCH-013: the product declares `buildRuntimeSession` its one session-construction seam, but the
 * OPTION surface reaching it was mapped by hand inside the initializer, mixed in with config merging
 * and path resolution. A projection that is not separately addressable is one nothing can check, and
 * that is how `guardrails`, `retrievalAdapter` and `effort` came to be declared, consumed, and never
 * set. `scan-option-reachability` measures this function's output against the declared surface.
 *
 * Nothing is decided here: every value is either passed through or read from `deps`.
 */
export interface ICreateSessionProjectionDeps {
  mergedConfig: ICreateSessionOptions['config'];
  cwd: ICreateSessionOptions['cwd'];
  context: ICreateSessionOptions['context'];
  projectInfo: ICreateSessionOptions['projectInfo'];
  sessionId: ICreateSessionOptions['sessionId'];
  logsDir: string;
  contextCapacityHint: ICreateSessionOptions['contextCapacityHint'];
}

export function buildCreateSessionOptions(
  options: IInitOptions,
  deps: ICreateSessionProjectionDeps,
): ICreateSessionOptions {
  const { mergedConfig, cwd, context, projectInfo, sessionId, logsDir, contextCapacityHint } = deps;
  return {
    config: mergedConfig,
    cwd,
    context,
    projectInfo,
    permissionMode: options.permissionMode,
    maxTurns: options.maxTurns,
    terminal: NOOP_TERMINAL,
    sessionLogger: new FileSessionLogger(logsDir),
    permissionHandler: options.permissionHandler,
    // CMD-005: the channel's unified ask renderer doubles as the model-question seam for tools.
    ...(options.askHandler ? { ask: options.askHandler } : {}),
    provider: options.provider,
    onTextDelta: options.onTextDelta,
    onContextUpdate: options.onContextUpdate,
    onCompactEvent: options.onCompactEvent,
    onToolExecution: options.onToolExecution,
    sessionId,
    allowedTools: options.allowedTools,
    deniedTools: options.deniedTools,
    model: options.model,
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    appendSystemPrompt: options.appendSystemPrompt,
    ...(options.persona !== undefined ? { persona: options.persona } : {}),
    ...(options.systemPrompt ? { systemPromptBuilder: () => options.systemPrompt! } : {}),
    backgroundTaskRunners: options.backgroundTaskRunners,
    subagentRunnerFactory: options.subagentRunnerFactory,
    // ARCH-005: composition-root-contributed subagent definitions (capability packs).
    ...(options.agentDefinitions ? { agentDefinitions: options.agentDefinitions } : {}),
    ...(options.commandModules?.some((module) =>
      module.sessionRequirements?.includes('agent-runtime'),
    )
      ? { enableAgentRuntime: true }
      : {}),
    ...(options.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: options.enableParallelSubagents }
      : {}),
    ...(options.selfVerification !== undefined
      ? { selfVerification: options.selfVerification }
      : {}),
    ...(options.commandModules || options.commandDescriptors
      ? {
          commandDescriptors: [
            ...(options.commandDescriptors ?? []),
            ...(options.commandModules?.flatMap((module) => module.commandDescriptors ?? []) ?? []),
          ],
        }
      : {}),
    modelCommandExecutor: options.modelCommandExecutor,
    isModelCommandInvocable: options.isModelCommandInvocable,
    editCheckpointRecorder: options.editCheckpointRecorder,
    reversibleExecution: options.reversibleExecution,
    sandboxClient: options.sandboxClient,
    agentName: options.agentName,
    ...(options.activePresetId !== undefined ? { activePresetId: options.activePresetId } : {}),
    ...(options.additionalTools ? { additionalTools: options.additionalTools } : {}),
    ...(options.defaultTools ? { defaultTools: options.defaultTools } : {}), // ARCH-006
    // GOAL-001: every interactive session exposes the goal completion-signal tool so /goal and
    // --goal can drive autonomous pursuit. It is inert unless a goal is active.
    includeGoalTool: true,
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    ...(contextCapacityHint !== undefined ? { contextCapacityHint } : {}),
  };
}
