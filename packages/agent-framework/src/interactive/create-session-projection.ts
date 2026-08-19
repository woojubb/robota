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
    // ARCH-013 stage 3 — the two consumer-supplied extension ports, and the one place they were lost.
    //
    // Both CONSUMING ends already worked: `create-session.ts` installs a `PreToolUse` guardrail hook
    // whenever the registry is non-empty, and `create-tools.ts` gates `CodebaseRetrieval` on the
    // adapter. Neither could be SET, because this projection dropped them — so two documented
    // capabilities (SELFHOST-005, SELFHOST-003) were UNREACHABLE from every public surface rather
    // than merely unused. The repo ships no implementation of either; they are extension ports, which
    // is precisely why a broken chain removed the capability instead of leaving it idle.
    //
    // A correction to this item's own analysis, recorded because a plan built on a wrong map is worse
    // than no plan: the task states that `ICreateSessionOptions.guardrails` (a name → function map)
    // and the config schema's `guardrails` (a string array) "cannot satisfy each other, no code
    // bridges them". They are not rivals. The config array sits on a guardrail HOOK definition and
    // selects WHICH registered guardrails run; this option is the registry that supplies them; and
    // `resolveGuardrailHooks` at `create-session.ts` is the bridge, which has existed all along.
    // Nothing needed reconciling — the registry simply had no way in.
    //
    // Conditional spreads for consistency with the ~15 optional keys around them, NOT because the
    // ARCH-029 spread hazard applies: review measured that it cannot fire here.
    // `exactOptionalPropertyTypes` is set nowhere in this repo, the consumer branches on truthiness,
    // and this object is passed straight into `createSession` rather than spread over a base. An
    // earlier revision of this comment cited that hazard as the reason — the right shape justified by
    // a mechanism that does not reach it, which is a claim to correct rather than keep.
    ...(options.guardrails !== undefined ? { guardrails: options.guardrails } : {}),
    ...(options.retrievalAdapter !== undefined
      ? { retrievalAdapter: options.retrievalAdapter }
      : {}),
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
    ...(options.commandSemanticRoles ? { commandSemanticRoles: options.commandSemanticRoles } : {}),
    modelCommandExecutor: options.modelCommandExecutor,
    isModelCommandInvocable: options.isModelCommandInvocable,
    editCheckpointRecorder: options.editCheckpointRecorder,
    reversibleExecution: options.reversibleExecution,
    sandboxClient: options.sandboxClient,
    // ARCH-033: projected beside the client, never derived from it — a client's class name is not a
    // registry key, and guessing one is how a child ends up looking sandboxed while sharing nothing.
    sandboxType: options.sandboxType,
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
