/**
 * Ink render entry point.
 */

import chalk from 'chalk';
import { render } from 'ink';
import React from 'react';

import App from './App.js';
import { isInteractiveColorTerminal } from './terminal-capabilities.js';
import { TerminalHandoffController } from './terminal-handoff-controller.js';
import { TuiInteractionChannel } from './TuiInteractionChannel.js';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { ITuiInteractionChannelOptions } from './TuiInteractionChannel.js';
import type {
  IAIProvider,
  IToolWithEventService,
  IProviderDefinition,
} from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IRemoteCommandPolicy,
  TSubagentRunnerFactory,
  IAgentDefinition,
  TShellExecFn,
  CommandRegistry,
  IMemoryStore,
  IAutomaticMemoryConfig,
  IPerTurnRecallConfig,
  TWorkspaceProjectAccess,
  EditCheckpointStore,
  IOrgPolicy,
} from '@robota-sdk/agent-framework';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

export interface IRenderOptions {
  cwd: string;
  provider: IAIProvider;
  projectAccess?: TWorkspaceProjectAccess;
  /**
   * CLI-083 (issue #2287) — the org policy, forwarded to the session so `blockedCommands` is
   * enforced on the plain `robota` path as well as under `--serve`.
   *
   * DECLARED, not merely spread through. The shell forwards this with
   * `...(orgPolicy === null ? {} : { orgPolicy })`, and a spread bypasses TypeScript's
   * excess-property check — so before this field existed the value compiled, arrived, and was
   * dropped by `toChannelOptions` below, which copies field by field. The idiom that looked safest
   * is what disabled the one check that would have caught the missing declaration.
   */
  orgPolicy?: IOrgPolicy | undefined;
  /** Explicit authority- and permission-backed edit checkpoint capability. */
  editCheckpointStore?: EditCheckpointStore;
  providerOverride?: string | undefined;
  /**
   * #1844: forwarded to the session so `/provider switch` can construct the provider it switches TO.
   *
   * The session cannot discover these — they are assembled at the composition root from the provider
   * packages. Without them the hot-swap throws with an empty supported-list, which is the failure
   * this option exists to prevent rather than a nicety.
   */
  providerDefinitions?: readonly IProviderDefinition[];
  providerType?: string | undefined;
  modelId?: string;
  /** ARCH-013: resolved preset effort, forwarded to the session's `effort` seam. */
  effort?: ITuiInteractionChannelOptions['effort'];
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  forkSession?: boolean;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /**
   * ARCH-005: subagent definitions contributed by the composition root (the capability packs
   * `assembleProduct` merged). Forwarded to the session's `agentDefinitions` seam; absent ⇒ unchanged.
   */
  agentDefinitions?: readonly IAgentDefinition[];
  /**
   * ARCH-006: tools contributed by the composition root (the capability packs `assembleProduct` merged)
   * and, when the profile hands the packs the whole tool surface, the suppressed framework default tier
   * (`defaultTools: []`). Forwarded to the session's tool-composition seam; absent ⇒ unchanged.
   */
  additionalTools?: IToolWithEventService[];
  defaultTools?: readonly IToolWithEventService[];
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
  /** REMOTE-006: optional remote-command policy (allow-by-default; local == remote). */
  remoteCommandPolicy?: IRemoteCommandPolicy;
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  cliAdapter: ITuiCliAdapter;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean;
  /**
   * Called with each live channel (including session-switch re-creations). Lets the embedding
   * product wire process-level concerns (ERR-001 G1: error routing into the live session).
   */
  onChannelReady?: (channel: TuiInteractionChannel) => void;
  /**
   * SELFHOST-008 P6: optional durable-memory store injected by the surface (agent-cli). Forwarded to the
   * channel → `buildRuntimeSession`; absent ⇒ memory OFF (today's behavior). Enablement is surface-owned.
   */
  memoryStore?: IMemoryStore;
  /** SELFHOST-008 P6: optional automatic post-turn capture policy (absent ⇒ capture OFF). */
  automaticMemory?: IAutomaticMemoryConfig;
  /** SELFHOST-008 P6: optional per-turn recall policy (absent ⇒ recall OFF, startup-only injection). */
  recallMemory?: IPerTurnRecallConfig;
}

/** Map render options to TuiInteractionChannel constructor options. */
export function toChannelOptions(
  options: IRenderOptions,
  resumeSessionId?: string,
): ConstructorParameters<typeof TuiInteractionChannel>[0] {
  // Contained — ARCH-110. This hand-maintained projection can silently omit optional composition-root
  // capabilities such as orgPolicy; keep the gap visible until ARCH-110 replaces or mechanically checks it.
  return {
    cwd: options.cwd,
    provider: options.provider,
    ...(options.projectAccess !== undefined ? { projectAccess: options.projectAccess } : {}),
    ...(options.orgPolicy !== undefined ? { orgPolicy: options.orgPolicy } : {}),
    ...(options.editCheckpointStore !== undefined
      ? { editCheckpointStore: options.editCheckpointStore }
      : {}),
    ...(options.providerDefinitions ? { providerDefinitions: options.providerDefinitions } : {}),
    // CLI-076: the display model id doubles as the session's model override so `--model` actually reaches
    // the provider chat call (header/status line == the model actually called).
    ...(options.modelId !== undefined ? { model: options.modelId } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    permissionMode: options.permissionMode,
    maxTurns: options.maxTurns,
    allowedTools: options.allowedTools,
    deniedTools: options.deniedTools,
    sessionStore: options.sessionStore,
    resumeSessionId,
    forkSession: options.forkSession,
    sessionName: options.sessionName,
    backgroundTaskRunners: options.backgroundTaskRunners,
    subagentRunnerFactory: options.subagentRunnerFactory,
    ...(options.agentDefinitions !== undefined
      ? { agentDefinitions: options.agentDefinitions }
      : {}),
    ...(options.additionalTools !== undefined ? { additionalTools: options.additionalTools } : {}),
    ...(options.defaultTools !== undefined ? { defaultTools: options.defaultTools } : {}),
    commandModules: options.commandModules,
    commandHostAdapters: options.commandHostAdapters,
    shellExec: options.shellExec,
    remoteCommandPolicy: options.remoteCommandPolicy,
    transportRegistry: options.transportRegistry,
    language: options.language,
    reloadPluginCommandSource: options.reloadPluginCommandSource,
    agentName: options.agentName,
    activePresetId: options.activePresetId,
    persona: options.persona,
    enableParallelSubagents: options.enableParallelSubagents,
    selfVerification: options.selfVerification,
    // SELFHOST-008 P6: forward the surface-resolved memory fields (absent ⇒ OFF).
    ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
    ...(options.automaticMemory ? { automaticMemory: options.automaticMemory } : {}),
    ...(options.recallMemory ? { recallMemory: options.recallMemory } : {}),
  };
}

export async function renderApp(options: IRenderOptions): Promise<void> {
  // ERR-001 / Library Neutrality Rule: NO process-level error policy here — process survival
  // is the product assembly's boundary (agent-cli installs the guards via onChannelReady).

  // SCREEN-006: chalk (ink's styling engine) does not implement the NO_COLOR convention itself
  // (verified: chalk 5's vendored supports-color reads only FORCE_COLOR/TTY/TERM), so on a real
  // TTY `NO_COLOR=1` would still color every component. Sync chalk once with the package's single
  // color gate (`terminal-capabilities.ts` — the SSOT that DOES honor NO_COLOR) so gate-off means
  // zero SGR color output. Gate-on changes nothing: chalk's own level detection stays authoritative.
  if (!isInteractiveColorTerminal()) {
    chalk.level = 0;
  }

  // TERM-002: one terminal-handoff controller per process (one Ink instance / App). Shared across
  // channel re-creations (session switch) so the handoff capability survives a session swap.
  const handoffController = new TerminalHandoffController();

  // Single-owner lifecycle (CLI-B12): render.tsx supplies only the factory;
  // App creates, replaces, and stops channels exclusively through React state.
  const createChannel = (resumeSessionId?: string): TuiInteractionChannel => {
    const channel = new TuiInteractionChannel({
      ...toChannelOptions(options, resumeSessionId),
      terminalHandoff: handoffController,
    });
    // Expose each live channel (incl. session-switch re-creations) to the embedding product,
    // e.g. for process-level error routing (ERR-001 G1).
    options.onChannelReady?.(channel);
    return channel;
  };

  const instance = render(
    <App
      cwd={options.cwd}
      createChannel={createChannel}
      providerOverride={options.providerOverride}
      providerType={options.providerType}
      modelId={options.modelId}
      permissionMode={options.permissionMode}
      version={options.version}
      sessionStore={options.sessionStore}
      resumeSessionId={options.resumeSessionId}
      showSessionPickerOnStart={options.showSessionPickerOnStart}
      startupUpdateNotice={options.startupUpdateNotice}
      transportRegistry={options.transportRegistry}
      cliAdapter={options.cliAdapter}
    />,
    { exitOnCtrlC: false },
  );
  // The controller needs the Ink instance to clear the frame before a handoff.
  handoffController.setInkInstance(instance);
  await instance.waitUntilExit();
}
