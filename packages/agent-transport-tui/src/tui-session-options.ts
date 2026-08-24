/**
 * ARCH-005 — the TUI's session-option mapping, split out of `TuiInteractionChannel`.
 *
 * Pure: it maps the channel's already-resolved options onto the framework's `TInteractiveSessionOptions`.
 * RUNTIME-001 — the channel then builds through the shared `buildRuntimeSession` seam (agent-framework),
 * never a private `new InteractiveSession`: one session-construction SSOT across the TUI, print, and
 * `--serve`.
 */

import type { ITuiInteractionChannelOptions } from './TuiInteractionChannel.js';
import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

/** Map the channel's resolved options onto the framework session-construction options. */
export function buildTuiSessionOptions(
  opts: ITuiInteractionChannelOptions,
): TInteractiveSessionOptions {
  // Contained — ARCH-110. This manual channel→session projection still omits `orgPolicy`; the
  // cross-surface projection fix and its mechanical guard belong to that root work item.
  return {
    cwd: opts.cwd,
    provider: opts.provider,
    ...(opts.projectAccess !== undefined ? { projectAccess: opts.projectAccess } : {}),
    ...(opts.editCheckpointStore !== undefined
      ? { editCheckpointStore: opts.editCheckpointStore }
      : {}),
    // CLI-076: forward the resolved model so `--model` takes effect rather than falling through to the
    // session's config/default model.
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
    permissionMode: opts.permissionMode,
    maxTurns: opts.maxTurns,
    // REMOTE-007: no injected permission/ask handlers — the TUI subscribes to the session's
    // transport-neutral `permission_request`/`ask_request` events (wireSessionEvents) and answers via
    // `resolvePermission`/`resolveAsk`. The local Ink queues + rendering are unchanged.
    sessionStore: opts.sessionStore,
    resumeSessionId: opts.resumeSessionId,
    forkSession: opts.forkSession,
    sessionName: opts.sessionName,
    backgroundTaskRunners: opts.backgroundTaskRunners,
    subagentRunnerFactory: opts.subagentRunnerFactory,
    ...(opts.agentDefinitions !== undefined ? { agentDefinitions: opts.agentDefinitions } : {}),
    ...(opts.additionalTools !== undefined ? { additionalTools: opts.additionalTools } : {}),
    ...(opts.defaultTools !== undefined ? { defaultTools: opts.defaultTools } : {}),
    commandModules: opts.commandModules,
    commandHostAdapters: opts.commandHostAdapters,
    shellExec: opts.shellExec,
    ...(opts.remoteCommandPolicy ? { remoteCommandPolicy: opts.remoteCommandPolicy } : {}),
    language: opts.language,
    agentName: opts.agentName,
    activePresetId: opts.activePresetId,
    persona: opts.persona,
    systemPrompt: opts.systemPrompt,
    appendSystemPrompt: opts.appendSystemPrompt,
    allowedTools: opts.allowedTools,
    deniedTools: opts.deniedTools,
    enableParallelSubagents: opts.enableParallelSubagents,
    selfVerification: opts.selfVerification,
    terminalHandoff: opts.terminalHandoff,
    // #1844: the session reads these when `/provider switch` hot-swaps. Absent, the switch throws
    // "Unknown provider: <name>. Currently supported: " with an EMPTY list — measured, not inferred.
    ...(opts.providerDefinitions ? { providerDefinitions: opts.providerDefinitions } : {}),
    // SELFHOST-008 P6: forward the surface-resolved memory fields only when present (absent ⇒ OFF).
    ...(opts.memoryStore ? { memoryStore: opts.memoryStore } : {}),
    ...(opts.automaticMemory ? { automaticMemory: opts.automaticMemory } : {}),
    ...(opts.recallMemory ? { recallMemory: opts.recallMemory } : {}),
  };
}
