/**
 * RUNTIME-001 — the headless `robota --serve` runtime host entry.
 *
 * Runs the shared `startRuntimeHost` (builds the session + serves the transports) and keeps the process alive
 * until signaled, then shuts the runtime down cleanly. Renders NO ink — this is the backend `apps/agent-app`
 * spawns (the GUI drives this shared runtime; it does not control the CLI's terminal UI). Kept ink-free: it
 * imports only the runtime host + framework/interface types, never a presentation package.
 */

import { parseToolList } from '../utils/cli-args.js';
import {
  openInBrowser,
  resolveWebRoot,
  startMonitorUiServer,
  type IMonitorUiServer,
} from './serve-monitor-ui.js';
import { startRuntimeHost } from '@robota-sdk/agent-framework';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IMemorySessionOptions } from '../startup/memory-enablement.js';
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
  /**
   * CLI-076: the resolved model id. Forwarded to the runtime session so an explicit `--model` override
   * reaches the provider chat call instead of being silently replaced by the session's default model.
   */
  model?: string;
  preset: IServeModePresetOptions;
  /** SELFHOST-008 P6: surface-resolved memory fields (empty ⇒ memory OFF, today's behavior). */
  memorySessionOptions?: IMemorySessionOptions;
  /**
   * GUI-007: resolve the live WS URL for the served monitor (`ws://127.0.0.1:<boundPort>`), read AFTER the
   * host has started (the port is only known once the WS transport binds). Absent ⇒ the monitor UI is not
   * served. The CLI composition root builds this from the registered `WsTransport.boundPort`.
   */
  getMonitorWsUrl?: () => string | undefined;
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
    // CLI-076: forward the resolved model so `--model` takes effect in the served runtime session.
    ...(opts.model !== undefined ? { model: opts.model } : {}),
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
    // SELFHOST-008 P6: surface-resolved memory fields (empty ⇒ memory OFF, today's behavior).
    ...(opts.memorySessionOptions ?? {}),
  };

  const host = await startRuntimeHost({
    session: sessionOptions,
    transportRegistry: opts.transportRegistry,
  });

  // GUI-007: with `--serve --open`, the CLI serves its OWN monitor SPA over localhost HTTP (a localhost-origin
  // surface) and opens it — gated on `--open` so the GUI sidecar's plain `--serve` path is unaffected. The WS
  // URL is resolved AFTER the host started (the bound port is only known then).
  let monitorUi: IMonitorUiServer | null = null;
  if (args.open) {
    const wsUrl = opts.getMonitorWsUrl?.();
    const webRoot = resolveWebRoot();
    if (wsUrl && webRoot) {
      monitorUi = await startMonitorUiServer(webRoot, wsUrl);
      process.stdout.write(`Web monitor: ${monitorUi.url}\n`);
      openInBrowser(monitorUi.url);
    } else if (!webRoot) {
      process.stderr.write('Web monitor assets not found (dist/web) — run a full CLI build.\n');
    }
  }

  // Stay alive until the supervisor (e.g. apps/agent-app on window close) signals — or a
  // host-executed session-exit/-restart action fires (CMD-004 Phase 2) — then tear down cleanly.
  await new Promise<void>((resolve) => {
    let settling = false;
    const settle = (reason: string): void => {
      if (settling) return;
      settling = true;
      void Promise.resolve(monitorUi?.close())
        .catch(() => {})
        .then(() => host.shutdown(reason))
        .finally(() => resolve());
    };
    const onSignal = (signal: NodeJS.Signals): void => settle(`received ${signal}`);
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    // CMD-004 Phase 2 (Stage B): late-bound serve-mode process adapter. A host-executed exit or
    // restart terminates the SHARED host serving ALL attached surfaces — the deliberate
    // local == remote decision (REMOTE-006): a remote driver is a full driver; a surface that only
    // wants to detach disconnects. The teardown is deferred one flush window so the in-flight
    // `command_result` reaches the requesting surface before the transports close. Restart ==
    // graceful exit here (the supervisor — e.g. the GUI sidecar — owns relaunching).
    const COMMAND_TEARDOWN_FLUSH_MS = 500;
    const scheduleSettle = (reason: string): void => {
      const timer = setTimeout(() => settle(reason), COMMAND_TEARDOWN_FLUSH_MS);
      timer.unref?.();
    };
    opts.commandHostAdapters.process = {
      requestExit: (reason) => scheduleSettle(`command exit${reason ? ` (${reason})` : ''}`),
      requestRestart: (_reason, message) => scheduleSettle(`command restart: ${message}`),
    };
  });
}
