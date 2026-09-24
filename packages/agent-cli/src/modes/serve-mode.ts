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
import {
  startSupervisedControl,
  type ISupervisedControl,
} from '../session-inventory/supervised-session-control.js';
import { startRuntimeHost } from '@robota-sdk/agent-framework';
import { presetSessionFields } from '../startup/preset-session-fields.js';
import { ROBOTA_PERMISSION_BASELINE } from '../product/robota-permission-baseline.js';
import type { IPresetSurfaceOptions } from '../startup/preset-surface-options.js';
import type { IOrgPolicy } from '@robota-sdk/agent-framework';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IMemorySessionOptions } from '../startup/memory-enablement.js';
import { areSessionLoopsDisabled, createLoopDefaultPromptResolver } from '../startup/loop-options.js';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IRemoteCommandPolicy,
  IProviderErrorGuidance,
  IProjectSettingsPath,
  INodeHostSettingsSource,
  IContributionSource,
  ISkillRootDescriptor,
  IToolCallHandoffPolicy,
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
  /** Explicit host-owned control root for isolated embedded runtimes and tests. */
  supervisedRoot?: string;
  args: IParsedCliArgs;
  provider: IAIProvider;
  providerErrorGuidance?: IProviderErrorGuidance;
  sessionStore: ReturnType<typeof createProjectSessionStore>;
  projectAccess?: TWorkspaceProjectAccess;
  projectSettingsPaths?: readonly IProjectSettingsPath[];
  userSettingsSources?: readonly INodeHostSettingsSource[];
  contributionSources?: readonly IContributionSource[];
  skillRoots?: readonly ISkillRootDescriptor[];
  taskContext?: { readonly enabled?: boolean; readonly dir?: string };
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
  agentDefinitionRoots?: readonly string[];
  pluginDirectories?: { readonly user?: string; readonly project?: string };
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
  /**
   * MCP-004 S3: the wrapper policy for MCP tool calls that outlive the threshold. Serve is one of
   * the two runtimes that adopts it (spec § Modes); absent ⇒ no MCP tool is wrapped, today's
   * behavior. Built by `mcp.buildToolCallHandoff(permissionMode)` AFTER `mcp.connect()`.
   */
  toolCallHandoff?: IToolCallHandoffPolicy;
  commandModules: readonly ICommandModule[];
  commandHostAdapters: ICommandHostAdapters;
  transportRegistry: ITransportLifecycleRegistryView;
  bindTransports?: (session: IInteractiveSession) => void;
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
    ...(opts.providerErrorGuidance !== undefined
      ? { providerErrorGuidance: opts.providerErrorGuidance }
      : {}),
    ...(opts.projectAccess !== undefined ? { projectAccess: opts.projectAccess } : {}),
    ...(opts.projectSettingsPaths !== undefined
      ? { projectSettingsPaths: opts.projectSettingsPaths }
      : {}),
    ...(opts.userSettingsSources !== undefined
      ? { userSettingsSources: opts.userSettingsSources }
      : {}),
    ...(opts.contributionSources !== undefined
      ? { contributionSources: opts.contributionSources }
      : {}),
    ...(opts.skillRoots !== undefined ? { skillRoots: opts.skillRoots } : {}),
    ...(opts.taskContext !== undefined ? { taskContext: opts.taskContext } : {}),
    ...(opts.orgPolicy !== undefined ? { orgPolicy: opts.orgPolicy } : {}),
    // CLI-076: forward the resolved model so `--model` takes effect in the served runtime session.
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(preset.outputStyle !== undefined ? { outputStyle: preset.outputStyle } : {}),
    permissionMode: args.permissionMode ?? preset.permissionMode,
    baselinePermissionAllow: ROBOTA_PERMISSION_BASELINE,
    // Issue #1937: the CLI-sourced prompt addition, composed once at the projection. Before this it
    // was built at print mode only, so these flags did nothing in a served session.
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : opts.sessionStore,
    disableSessionLoops: areSessionLoopsDisabled(process.env),
    resolveDefaultLoopPrompt: createLoopDefaultPromptResolver({ projectAccess: opts.projectAccess, userHome: homedir() }),
    resumeSessionId: opts.resumeSessionId,
    forkSession: args.forkSession,
    sessionName: args.sessionName,
    backgroundTaskRunners: opts.backgroundTaskRunners,
    subagentRunnerFactory: opts.subagentRunnerFactory,
    ...(opts.agentDefinitions !== undefined ? { agentDefinitions: opts.agentDefinitions } : {}),
    ...(opts.agentDefinitionRoots !== undefined
      ? { agentDefinitionRoots: opts.agentDefinitionRoots }
      : {}),
    ...(opts.pluginDirectories !== undefined
      ? { pluginDirectories: opts.pluginDirectories }
      : {}),
    ...(opts.additionalTools !== undefined ? { additionalTools: opts.additionalTools } : {}),
    ...(opts.defaultTools !== undefined ? { defaultTools: opts.defaultTools } : {}),
    ...(opts.toolCallHandoff !== undefined ? { toolCallHandoff: opts.toolCallHandoff } : {}),
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
    ...(preset.responseFormat !== undefined ? { responseFormat: preset.responseFormat } : {}),
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
    ...(opts.bindTransports ? { bindTransports: opts.bindTransports } : {}),
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
  let supervisedControl: ISupervisedControl | undefined;
  let requestSettle: (reason: string) => void = () => undefined;
  let settling = false;
  const readinessAbort = new AbortController();
  const lifetime = new Promise<void>((resolve) => {
    const settle = (reason: string): void => {
      if (settling) return;
      settling = true;
      readinessAbort.abort();
      void Promise.resolve(monitorUi?.close())
        .catch(() => {})
        .then(() => host.shutdown(reason))
        .catch(() => undefined)
        .then(() => supervisedControl?.close())
        .finally(() => resolve());
    };
    requestSettle = settle;
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
  if (args.supervisedSessionId !== undefined) {
    try {
      const supervisedCwd = realpathSync(opts.cwd);
      supervisedControl = await startSupervisedControl(
        args.supervisedSessionId,
        () => requestSettle('supervised session stopped'),
        opts.supervisedRoot,
        () => settling ? undefined : host.session.getLocalActivityStatus(),
        () => settling ? undefined : supervisedCwd,
      );
      if (settling) throw new Error('Supervised runtime stopped before readiness.');
      await acknowledgeSupervisedStartup(args.supervisedSessionId, readinessAbort.signal);
      if (settling) throw new Error('Supervised runtime stopped during readiness.');
    } catch (error) {
      if (process.connected && process.send) {
        try {
          process.send({ kind: 'error', id: args.supervisedSessionId, code: 'startup-failed' }, () => {
            // The parent may already have disconnected; failure reporting is best-effort only.
          });
        } catch {
          // A closed readiness channel cannot prevent host/control cleanup below.
        }
      }
      requestSettle('supervised session startup failed');
      await supervisedControl?.close();
      await lifetime;
      throw error;
    }
  }
  await lifetime;
}

export interface ISupervisedReadinessChannel {
  send(message: { kind: 'ready' | 'acknowledged'; id: string }, done: (error?: Error | null) => void): void;
  onMessage(listener: (message: unknown) => void): void;
  offMessage(listener: (message: unknown) => void): void;
  onDisconnect(listener: () => void): void;
  offDisconnect(listener: () => void): void;
}

function processReadinessChannel(): ISupervisedReadinessChannel {
  if (!process.send) throw new Error('Supervised serve mode requires a parent readiness channel.');
  return {
    send: (message, done) => { process.send?.(message, done); },
    onMessage: (listener) => { process.on('message', listener); },
    offMessage: (listener) => { process.off('message', listener); },
    onDisconnect: (listener) => { process.on('disconnect', listener); },
    offDisconnect: (listener) => { process.off('disconnect', listener); },
  };
}

/** The launcher must receive readiness and acknowledge it before this runtime detaches. */
export async function acknowledgeSupervisedStartup(
  id: string,
  signal: AbortSignal,
  channel: ISupervisedReadinessChannel = processReadinessChannel(),
): Promise<void> {
  if (signal.aborted) throw new Error('Supervised runtime stopped before readiness.');
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (action: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      channel.offMessage(onMessage);
      channel.offDisconnect(onDisconnect);
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const onMessage = (message: unknown): void => {
      if (signal.aborted) {
        finish(() => reject(new Error('Supervised runtime stopped during readiness.')));
        return;
      }
      if (typeof message !== 'object' || message === null || !('kind' in message) ||
        !('id' in message) || message.kind !== 'ack' || message.id !== id) {
        finish(() => reject(new Error('Supervised startup acknowledgement was invalid.')));
        return;
      }
      channel.send({ kind: 'acknowledged', id }, (error) => {
        if (signal.aborted || error) finish(() => reject(new Error('Supervised startup acknowledgement could not be sent.')));
        else finish(resolve);
      });
    };
    const onAbort = (): void => finish(() => reject(new Error('Supervised runtime stopped during readiness.')));
    const onDisconnect = (): void => finish(() => reject(new Error('Supervised launcher closed before acknowledgement.')));
    const timer = setTimeout(() => finish(() => reject(new Error('Supervised launcher did not acknowledge startup.'))), 10_000);
    channel.onMessage(onMessage);
    channel.onDisconnect(onDisconnect);
    signal.addEventListener('abort', onAbort, { once: true });
    channel.send({ kind: 'ready', id }, (error) => {
      if (error) finish(() => reject(new Error('Supervised readiness could not be sent.')));
    });
  });
}
