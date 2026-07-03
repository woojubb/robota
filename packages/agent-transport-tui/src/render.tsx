/**
 * Ink render entry point.
 */

import { render } from 'ink';
import React from 'react';

import App from './App.js';
import { TerminalHandoffController } from './terminal-handoff-controller.js';
import { TuiInteractionChannel } from './TuiInteractionChannel.js';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  TSubagentRunnerFactory,
  TShellExecFn,
  CommandRegistry,
} from '@robota-sdk/agent-framework';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';

export interface IRenderOptions {
  cwd: string;
  provider: IAIProvider;
  providerOverride?: string | undefined;
  providerType?: string | undefined;
  modelId?: string;
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  allowedTools?: string[];
  deniedTools?: string[];
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  forkSession?: boolean;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
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
}

/** Map render options to TuiInteractionChannel constructor options. */
export function toChannelOptions(
  options: IRenderOptions,
  resumeSessionId?: string,
): ConstructorParameters<typeof TuiInteractionChannel>[0] {
  return {
    cwd: options.cwd,
    provider: options.provider,
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
    commandModules: options.commandModules,
    commandHostAdapters: options.commandHostAdapters,
    shellExec: options.shellExec,
    transportRegistry: options.transportRegistry,
    language: options.language,
    reloadPluginCommandSource: options.reloadPluginCommandSource,
    agentName: options.agentName,
    activePresetId: options.activePresetId,
    persona: options.persona,
    enableParallelSubagents: options.enableParallelSubagents,
    selfVerification: options.selfVerification,
  };
}

export async function renderApp(options: IRenderOptions): Promise<void> {
  // ERR-001 / Library Neutrality Rule: NO process-level error policy here — process survival
  // is the product assembly's boundary (agent-cli installs the guards via onChannelReady).

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
