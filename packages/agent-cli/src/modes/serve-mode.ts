/**
 * RUNTIME-001 — the headless `robota --serve` runtime host entry.
 *
 * Runs the shared `startRuntimeHost` (builds the session + serves the transports) and keeps the process alive
 * until signaled, then shuts the runtime down cleanly. Renders NO ink — this is the backend `apps/agent-app`
 * spawns (the GUI drives this shared runtime; it does not control the CLI's terminal UI). Kept ink-free: it
 * imports only the runtime host + framework/interface types, never a presentation package.
 */

import { parseToolList } from '../utils/cli-args.js';
import { startRuntimeHost } from '../runtime/runtime-host.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IRemoteCommandPolicy,
  TInteractiveSessionOptions,
  createProjectSessionStore,
} from '@robota-sdk/agent-framework';
import type { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';
import type {
  IInteractiveSession,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';

/** Preset-resolved identity/posture the thin-shell CLI forwards into the headless runtime session. */
export interface IServeModePresetOptions {
  agentName?: string;
  activePresetId?: string;
  persona?: string;
  permissionMode?: TInteractiveSessionOptions['permissionMode'];
  enableParallelSubagents?: boolean;
  selfVerification?: boolean;
}

export interface IServeModeOptions {
  cwd: string;
  args: IParsedCliArgs;
  provider: IAIProvider;
  sessionStore: ReturnType<typeof createProjectSessionStore>;
  backgroundTaskRunners: IBackgroundTaskRunner[];
  subagentRunnerFactory: ReturnType<typeof createChildProcessSubagentRunnerFactory>;
  commandModules: readonly ICommandModule[];
  commandHostAdapters: ICommandHostAdapters;
  transportRegistry: ITransportRegistryView<IInteractiveSession>;
  remoteCommandPolicy?: IRemoteCommandPolicy;
  resumeSessionId?: string;
  preset: IServeModePresetOptions;
}

/**
 * Build the runtime session options (mirroring the interactive mapping — NOT print-mode's autonomous
 * `bypassPermissions` default) and run the host until SIGTERM/SIGINT, then shut down and exit 0.
 */
export async function runServeMode(opts: IServeModeOptions): Promise<void> {
  const { args, preset } = opts;
  const sessionOptions: TInteractiveSessionOptions = {
    cwd: opts.cwd,
    provider: opts.provider,
    permissionMode: args.permissionMode ?? preset.permissionMode,
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : opts.sessionStore,
    resumeSessionId: opts.resumeSessionId,
    forkSession: args.forkSession,
    sessionName: args.sessionName,
    backgroundTaskRunners: opts.backgroundTaskRunners,
    subagentRunnerFactory: opts.subagentRunnerFactory,
    commandModules: opts.commandModules,
    commandHostAdapters: opts.commandHostAdapters,
    ...(opts.remoteCommandPolicy ? { remoteCommandPolicy: opts.remoteCommandPolicy } : {}),
    language: args.language,
    allowedTools: parseToolList(args.allowedTools),
    deniedTools: parseToolList(args.deniedTools),
    ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
    ...(preset.agentName !== undefined ? { agentName: preset.agentName } : {}),
    ...(preset.activePresetId !== undefined ? { activePresetId: preset.activePresetId } : {}),
    ...(preset.persona !== undefined ? { persona: preset.persona } : {}),
    ...(preset.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: preset.enableParallelSubagents }
      : {}),
    ...(preset.selfVerification !== undefined ? { selfVerification: preset.selfVerification } : {}),
  };

  const host = await startRuntimeHost({
    session: sessionOptions,
    transportRegistry: opts.transportRegistry,
  });

  // Stay alive until the supervisor (e.g. apps/agent-app on window close) signals; then tear down cleanly.
  await new Promise<void>((resolve) => {
    let settling = false;
    const onSignal = (signal: NodeJS.Signals): void => {
      if (settling) return;
      settling = true;
      void host.shutdown(`received ${signal}`).finally(() => resolve());
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  });
}
