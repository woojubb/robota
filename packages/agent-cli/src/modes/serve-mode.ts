/**
 * RUNTIME-001 — the headless `robota --serve` runtime host entry.
 *
 * Runs the shared `startRuntimeHost` (builds the session + serves the transports) and keeps the process alive
 * until signaled, then shuts the runtime down cleanly. Renders NO ink — this is the backend `apps/agent-app`
 * spawns (the GUI drives this shared runtime; it does not control the CLI's terminal UI). Kept ink-free: it
 * imports only the runtime host + framework/interface types, never a presentation package.
 */

import {
  openInBrowser,
  resolveWebRoot,
  startMonitorUiServer,
  type IMonitorUiServer,
} from './serve-monitor-ui.js';
import { settleOnServeTransportFailure } from './serve-transport-failure.js';
import { startRuntimeHost } from '@robota-sdk/agent-framework';
import { presetSessionFields } from '../startup/preset-session-fields.js';
import type { IPresetSurfaceOptions } from '../startup/preset-surface-options.js';
import type { ICreateSessionOptions, IOrgPolicy } from '@robota-sdk/agent-framework';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IMemorySessionOptions } from '../startup/memory-enablement.js';
import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IRemoteCommandPolicy,
  TInteractiveSessionOptions,
  TWorkspaceProjectAccess,
  createProjectSessionStore,
} from '@robota-sdk/agent-framework';
import type { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';
import type { ITransportLifecycleRegistryView } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

/** Preset-resolved identity/posture the thin-shell CLI forwards into the headless runtime session. */
/**
 * ARCH-041: ONE declaration — see the note on `IPrintModePresetOptions`. This was the third copy.
 */
export type IServeModePresetOptions = Partial<IPresetSurfaceOptions>;

export interface IServeModeOptions {
  cwd: string;
  args: IParsedCliArgs;
  provider: IAIProvider;
  sessionStore: ReturnType<typeof createProjectSessionStore>;
  projectAccess?: TWorkspaceProjectAccess;
  /**
   * CLI-083 (issue #2287) — the org policy, forwarded so the session's `blockedCommands` and
   * `allowedProviders` enforcement is reachable in a served session. Declared on this projection
   * for the reason stated above `buildServeSessionOptions`: a field carried by one shell and
   * dropped by another is invisible, so each projection is tested for it separately.
   */
  orgPolicy?: IOrgPolicy | undefined;
  backgroundTaskRunners: IBackgroundTaskRunner[];
  subagentRunnerFactory: ReturnType<typeof createChildProcessSubagentRunnerFactory>;
  /** ARCH-005: composition-root-contributed subagent definitions (the profile's merged pack subagents). */
  agentDefinitions?: readonly IAgentDefinition[];
  /**
   * ARCH-006/007: the profile's merged pack TOOLS, laid on by the kernel overlay. Forwarded to the
   * session's `additionalTools` seam, where the framework dedupes them by name against its own default
   * tier (first occurrence wins — see `agent-framework/docs/SPEC.md` § "Session-level tool composition").
   */
  additionalTools?: IToolWithEventService[];
  /**
   * ARCH-006: REPLACES `agent-framework`'s `createDefaultTools()` tier. `robota` passes an empty array so
   * its capability packs are the SOLE source of the session's tools.
   */
  defaultTools?: readonly IToolWithEventService[];
  commandModules: readonly ICommandModule[];
  commandHostAdapters: ICommandHostAdapters;
  transportRegistry: ITransportLifecycleRegistryView<IInteractiveSession>;
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
/**
 * The session options a served runtime starts with.
 *
 * Extracted so a case can assert what serve mode forwards WITHOUT starting a server. Issue #1937 is
 * the reason: a field can be declared on the projection, forwarded by two shells and dropped by the
 * third, and nothing would have said so — `buildAppendSystemPrompt` had exactly one caller for that
 * whole time. A test of the helper is green in that state; a test of this is not.
 */
export function buildServeSessionOptions(opts: IServeModeOptions): TInteractiveSessionOptions {
  const { args, preset } = opts;
  return {
    cwd: opts.cwd,
    provider: opts.provider,
    ...(opts.projectAccess !== undefined ? { projectAccess: opts.projectAccess } : {}),
    ...(opts.orgPolicy !== undefined ? { orgPolicy: opts.orgPolicy } : {}),
    // CLI-076: forward the resolved model so `--model` takes effect in the served runtime session.
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    permissionMode: args.permissionMode ?? preset.permissionMode,
    // Issue #1937: the CLI-sourced prompt addition, composed once at the projection. Before this it
    // was built at print mode only, so these flags did nothing in a served session.
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : opts.sessionStore,
    resumeSessionId: opts.resumeSessionId,
    forkSession: args.forkSession,
    sessionName: args.sessionName,
    backgroundTaskRunners: opts.backgroundTaskRunners,
    subagentRunnerFactory: opts.subagentRunnerFactory,
    ...(opts.agentDefinitions !== undefined ? { agentDefinitions: opts.agentDefinitions } : {}),
    ...(opts.additionalTools !== undefined ? { additionalTools: opts.additionalTools } : {}),
    ...(opts.defaultTools !== undefined ? { defaultTools: opts.defaultTools } : {}),
    commandModules: opts.commandModules,
    commandHostAdapters: opts.commandHostAdapters,
    ...(opts.remoteCommandPolicy ? { remoteCommandPolicy: opts.remoteCommandPolicy } : {}),
    language: args.language,
    ...presetSessionFields(preset),
    ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
    ...(preset.agentName !== undefined ? { agentName: preset.agentName } : {}),
    ...(preset.activePresetId !== undefined ? { activePresetId: preset.activePresetId } : {}),
    ...(preset.persona !== undefined ? { persona: preset.persona } : {}),
    ...(preset.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: preset.enableParallelSubagents }
      : {}),
    ...(preset.selfVerification !== undefined ? { selfVerification: preset.selfVerification } : {}),
    ...(preset.effort !== undefined ? { effort: preset.effort } : {}),
    ...(preset.temperature !== undefined ? { temperature: preset.temperature } : {}),
    ...(preset.maxOutputTokens !== undefined ? { maxOutputTokens: preset.maxOutputTokens } : {}),
    ...(preset.language !== undefined ? { language: preset.language } : {}),
    // ARCH-040: onto the SEED key, never onto `systemPrompt` — that one replaces the composed prompt.
    ...(preset.systemPrompt !== undefined ? { presetSystemPrompt: preset.systemPrompt } : {}),
    // SELFHOST-008 P6: surface-resolved memory fields (empty ⇒ memory OFF, today's behavior).
    ...(opts.memorySessionOptions ?? {}),
  };
}

export async function runServeMode(opts: IServeModeOptions): Promise<void> {
  const { args } = opts;
  const sessionOptions = buildServeSessionOptions(opts);

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
    // A nonzero runner result is a normal typed outcome, not an exception. The failure wait resolves
    // immediately for the first such record and does not wait for an unrelated runner that remains
    // alive. No runners/all-success/stop abandonment resolve `undefined` and leave serve mode alive.
    void settleOnServeTransportFailure(
      host,
      {
        setExitCode: (code) => {
          process.exitCode = code;
        },
        writeError: (message) => {
          process.stderr.write(message);
        },
      },
      settle,
    );
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
