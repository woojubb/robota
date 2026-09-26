/**
 * Ink render entry point.
 */

import chalk from 'chalk';
import { render } from 'ink';
import React from 'react';

import App from './App.js';
import { AttentionTracker } from './attention/attention-tracker.js';
import { FocusReportingStdin } from './attention/focus-input-filter.js';
import { KeybindingsProvider } from './keybindings/keybindings-context.js';
import { ProductDisplayNameProvider } from './product-display-name-context.js';
import { writeScreenReaderAnnouncement } from './screen-reader-announcement.js';
import { ScreenReaderProvider } from './screen-reader-context.js';
import { ScreenReaderPacingProvider } from './screen-reader-pacing-context.js';
import { awaitStartupQuietPeriod, resolvePacing } from './screen-reader-pacing.js';
import type { IScreenReaderPacingOverrides } from './screen-reader-pacing.js';
import { createParkedStdout, toPacingPort } from './screen-reader-stdout.js';
import { isInteractiveColorTerminal, supportsFocusReporting } from './terminal-capabilities.js';
import { TerminalCapabilitiesProvider } from './terminal-capabilities-context.js';
import type { ITerminalCapabilityOverrides } from './terminal-capabilities-context.js';
import { createFocusReportingWriter } from './terminal-focus-reporting.js';
import { TerminalHandoffController } from './terminal-handoff-controller.js';
import { TuiInteractionChannel } from './TuiInteractionChannel.js';
import { WireTuiChannel } from './wire-tui-channel.js';

import type {
  IAttachedSessionConnection,
  TAttachedSessionEnd,
} from './attached-session-connection.js';
import type { IAttentionSource } from './attention/attention-tracker.js';
import type { IKeybindingsSource } from './keybindings/node-keybindings-source.js';
import type { TScreenReaderChannel } from './screen-reader-announcement.js';
import type { IThemeRegistry } from './theme/theme-registry.js';
import type { ITuiAppChannelPort } from './tui-app-channel-port.js';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { ITuiInteractionChannelOptions } from './TuiInteractionChannel.js';
import type { ITuiClientCommands } from './wire-tui-client-commands.js';
import type {
  IAIProvider,
  IToolWithEventService,
  IProviderDefinition,
} from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  IOutputStylePrompt,
  ICommandModule,
  IRemoteCommandPolicy,
  TSubagentRunnerFactory,
  IAgentDefinition,
  TShellExecFn,
  CommandRegistry,
  IMemoryStore,
  IPromptHistoryOptions,
  IAutomaticMemoryConfig,
  IPerTurnRecallConfig,
  TWorkspaceProjectAccess,
  EditCheckpointStore,
  TInteractiveSessionOptions,
  IOrgPolicy,
  IProviderErrorGuidance,
  IProjectSettingsPath,
  IContributionSource,
  ISkillRootDescriptor,
  INodeHostSettingsSource,
  IToolCallHandoffPolicy,
  ICreateSessionOptions,
  ILivePromptTracePort,
} from '@robota-sdk/agent-framework';
import type { TReducedMotionOverride } from '@robota-sdk/agent-interface-command';
import type {
  IInteractiveSessionStore,
  IPromptHistorySource,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

export interface IRenderOptions {
  cwd: string;
  livePromptTrace?: ILivePromptTracePort;
  /** Product identity for terminal labels, title, and host-facing copy. */
  productDisplayName?: string;
  modelCommandToolPrefix?: string;
  subagentHookEnvironmentNames?: ICreateSessionOptions['subagentHookEnvironmentNames'];
  observerFailureWarningCode?: ICreateSessionOptions['observerFailureWarningCode'];
  commandHookShell?: string;
  /** Skip instruction files and plugin discovery (`--safe-mode`). */
  bare?: boolean;
  /** Run no hook the settings layers declare (`--safe-mode`). */
  skipConfiguredHooks?: boolean;
  promptFileReferenceTag?: string;
  provider: IAIProvider;
  providerErrorGuidance?: IProviderErrorGuidance;
  projectAccess?: TWorkspaceProjectAccess;
  projectSettingsPaths?: readonly IProjectSettingsPath[];
  baselinePermissionAllow?: readonly string[];
  /** Host-selected task-context root; absent means no framework task-directory scan. */
  taskContext?: { readonly enabled?: boolean; readonly dir?: string };
  contributionSources?: readonly IContributionSource[];
  skillRoots?: readonly ISkillRootDescriptor[];
  userSettingsSources?: readonly INodeHostSettingsSource[];
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
  /**
   * Builds the authority- and permission-backed edit checkpoint store for one session; absent, no
   * session keeps checkpoints. A factory, not a store: a session switch builds the next channel
   * while the old session may still be finishing a turn, and a store holds one turn in progress.
   */
  createEditCheckpointStore?: () => EditCheckpointStore;
  /** The host's way to build each external-event grant's verifier; absent, no grant opens. */
  externalEventVerifierFactory?: TInteractiveSessionOptions['externalEventVerifierFactory'];
  /**
   * #3189: the run's grant history, handed to every session this TUI builds so a switch replays no
   * spent token and resets no rate. DECLARED for the reason `orgPolicy` above is.
   */
  externalEventGrantHistory?: TInteractiveSessionOptions['externalEventGrantHistory'];
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
  /** CLI-1988: resolved provider-neutral response style. */
  outputStyle?: IOutputStylePrompt;
  /** ARCH-013: resolved preset effort, forwarded to the session's `effort` seam. */
  effort?: ITuiInteractionChannelOptions['effort'];
  temperature?: number;
  maxOutputTokens?: number;
  /** Preset prompt seed, distinct from the replacing `systemPrompt` option. */
  presetSystemPrompt?: string;
  /** CLI-sourced additive prompt text, composed before the TUI is rendered. */
  appendSystemPrompt?: string;
  responseFormat?: ITuiInteractionChannelOptions['responseFormat'];
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  disableSessionLoops?: boolean;
  resolveDefaultLoopPrompt?: () => string;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  /** FLOW-2006: text a deep link prefilled into the composer. Never submitted on its own. */
  initialInput?: string;
  /** Where that text came from; `external-link` renders the provenance notice. */
  initialInputOrigin?: 'external-link';
  forkSession?: boolean;
  /** Issue #3081: the startup session is the target of a `/cd` from this directory. */
  workspaceMovedFrom?: string;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** MCP-004: the tool-call handoff policy the composition root computed for this runtime. */
  toolCallHandoff?: IToolCallHandoffPolicy;
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /**
   * ARCH-005: subagent definitions contributed by the composition root (the capability packs
   * `assembleProduct` merged). Forwarded to the session's `agentDefinitions` seam; absent ⇒ unchanged.
   */
  agentDefinitions?: readonly IAgentDefinition[];
  agentDefinitionRoots?: readonly string[];
  pluginDirectories?: { readonly user?: string; readonly project?: string };
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
  transportRegistry?: ITransportRegistryView;
  bindTransports?: ITuiInteractionChannelOptions['bindTransports'];
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
  /**
   * CLI-2004: the resolved screen-reader mode. DECLARED, not spread through — `toChannelOptions`
   * below copies field by field, so an undeclared field compiles, arrives and is silently dropped
   * (the ARCH-110 containment hazard the `orgPolicy` comment above records). Absent ⇒ mode OFF and
   * today's byte stream is unchanged.
   */
  screenReader?: boolean | undefined;
  /** Host-selected raw timing overrides; absent values use the renderer's defaults. */
  screenReaderPacing?: IScreenReaderPacingOverrides;
  /** Host-selected cursor and turn-mark overrides; absent values use terminal detection. */
  terminalCapabilities?: ITerminalCapabilityOverrides;
  /** CLI-2004: which input turned the mode on — printed in the confirmation line. */
  screenReaderChannel?: TScreenReaderChannel | undefined;
  /** CLI-2004: mode off, but the environment suggests a reader is running ⇒ one advisory line. */
  screenReaderHint?: boolean | undefined;
  /** BEHAVIOR-2003: one watched source shared with the optional `/keybindings` command. */
  keybindingsSource?: IKeybindingsSource;
  /**
   * SCREEN-2002: the theme catalogue this run renders from, shared with the optional `/theme`
   * command. DECLARED, not spread — see the `screenReader` note above. Absent ⇒ the built-ins.
   */
  themeRegistry?: IThemeRegistry;
  /** SCREEN-2002: reduced motion as the product shell resolved it (settings ← env ← flag). */
  reducedMotion?: boolean | undefined;
  /** SCREEN-2002: which tier decided it, when that was not the settings. */
  reducedMotionOverride?: TReducedMotionOverride | undefined;
  /**
   * SCREEN-1992: the focus-reporting override the product shell resolved from its own environment.
   * `true` forces DECSET 1004 on, `false` is the kill switch, absent ⇒ on for an interactive TTY.
   */
  focusReporting?: boolean | undefined;
  /**
   * SCREEN-1993: prompt history, resolved by the product shell. `promptHistory` is the session-side
   * writer (forwarded to the channel like `memoryStore`); `promptHistorySource` and
   * `promptHistoryProject` feed the input area's Ctrl+R search. DECLARED, not spread through — the
   * projection below copies field by field. Absent ⇒ nothing is written and `ctrl+r` is inert.
   */
  promptHistory?: IPromptHistoryOptions;
  promptHistorySource?: IPromptHistorySource;
  promptHistoryProject?: string;
}

/** Map render options to TuiInteractionChannel constructor options. */
export function toChannelOptions(
  options: IRenderOptions,
  resumeSessionId?: string,
): ConstructorParameters<typeof TuiInteractionChannel>[0] {
  return {
    cwd: options.cwd,
    ...(options.livePromptTrace ? { livePromptTrace: options.livePromptTrace } : {}),
    provider: options.provider,
    ...(options.providerErrorGuidance !== undefined
      ? { providerErrorGuidance: options.providerErrorGuidance }
      : {}),
    ...(options.promptFileReferenceTag !== undefined
      ? { promptFileReferenceTag: options.promptFileReferenceTag }
      : {}),
    ...(options.modelCommandToolPrefix !== undefined
      ? { modelCommandToolPrefix: options.modelCommandToolPrefix }
      : {}),
    ...(options.subagentHookEnvironmentNames !== undefined
      ? { subagentHookEnvironmentNames: options.subagentHookEnvironmentNames }
      : {}),
    ...(options.observerFailureWarningCode !== undefined
      ? { observerFailureWarningCode: options.observerFailureWarningCode }
      : {}),
    ...(options.commandHookShell !== undefined
      ? { commandHookShell: options.commandHookShell }
      : {}),
    ...(options.bare === true ? { bare: true } : {}),
    ...(options.skipConfiguredHooks === true ? { skipConfiguredHooks: true } : {}),
    ...(options.projectAccess !== undefined ? { projectAccess: options.projectAccess } : {}),
    ...(options.projectSettingsPaths !== undefined
      ? { projectSettingsPaths: options.projectSettingsPaths }
      : {}),
    ...(options.baselinePermissionAllow !== undefined
      ? { baselinePermissionAllow: options.baselinePermissionAllow }
      : {}),
    ...(options.taskContext !== undefined ? { taskContext: options.taskContext } : {}),
    ...(options.contributionSources !== undefined
      ? { contributionSources: options.contributionSources }
      : {}),
    ...(options.skillRoots !== undefined ? { skillRoots: options.skillRoots } : {}),
    ...(options.userSettingsSources !== undefined
      ? { userSettingsSources: options.userSettingsSources }
      : {}),
    ...(options.orgPolicy !== undefined ? { orgPolicy: options.orgPolicy } : {}),
    ...(options.externalEventVerifierFactory !== undefined
      ? { externalEventVerifierFactory: options.externalEventVerifierFactory }
      : {}),
    ...(options.externalEventGrantHistory !== undefined
      ? { externalEventGrantHistory: options.externalEventGrantHistory }
      : {}),
    ...(options.providerDefinitions ? { providerDefinitions: options.providerDefinitions } : {}),
    // CLI-076: the display model id doubles as the session's model override so `--model` actually reaches
    // the provider chat call (header/status line == the model actually called).
    ...(options.modelId !== undefined ? { model: options.modelId } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.presetSystemPrompt !== undefined
      ? { presetSystemPrompt: options.presetSystemPrompt }
      : {}),
    ...(options.appendSystemPrompt !== undefined
      ? { appendSystemPrompt: options.appendSystemPrompt }
      : {}),
    ...(options.responseFormat !== undefined ? { responseFormat: options.responseFormat } : {}),
    ...(options.outputStyle !== undefined ? { outputStyle: options.outputStyle } : {}),
    permissionMode: options.permissionMode,
    maxTurns: options.maxTurns,
    allowedTools: options.allowedTools,
    deniedTools: options.deniedTools,
    sessionStore: options.sessionStore,
    disableSessionLoops: options.disableSessionLoops,
    resolveDefaultLoopPrompt: options.resolveDefaultLoopPrompt,
    resumeSessionId,
    forkSession: options.forkSession,
    sessionName: options.sessionName,
    backgroundTaskRunners: options.backgroundTaskRunners,
    ...(options.toolCallHandoff !== undefined ? { toolCallHandoff: options.toolCallHandoff } : {}),
    subagentRunnerFactory: options.subagentRunnerFactory,
    ...(options.agentDefinitions !== undefined
      ? { agentDefinitions: options.agentDefinitions }
      : {}),
    ...(options.agentDefinitionRoots !== undefined
      ? { agentDefinitionRoots: options.agentDefinitionRoots }
      : {}),
    ...(options.pluginDirectories !== undefined
      ? { pluginDirectories: options.pluginDirectories }
      : {}),
    ...(options.additionalTools !== undefined ? { additionalTools: options.additionalTools } : {}),
    ...(options.defaultTools !== undefined ? { defaultTools: options.defaultTools } : {}),
    commandModules: options.commandModules,
    commandHostAdapters: options.commandHostAdapters,
    shellExec: options.shellExec,
    remoteCommandPolicy: options.remoteCommandPolicy,
    transportRegistry: options.transportRegistry,
    bindTransports: options.bindTransports,
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
    // CLI-2004: declared above AND projected here — the hand-maintained copy is the exact place an
    // undeclared option disappears, so both halves are asserted by one test.
    ...(options.screenReader !== undefined ? { screenReader: options.screenReader } : {}),
    // SCREEN-1993: the session-side writer (absent ⇒ nothing is recorded).
    promptHistory: options.promptHistory,
  };
}

export async function waitForRenderAndStop<TResult>(
  waitUntilExit: () => Promise<TResult>,
  getActiveChannel: () => Pick<ITuiAppChannelPort, 'stop'> | undefined,
): Promise<void> {
  let renderFailure: Error | undefined;
  try {
    await waitUntilExit();
  } catch (cause) {
    renderFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  let stopFailure: Error | undefined;
  try {
    await getActiveChannel()?.stop();
  } catch (cause) {
    stopFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  if (renderFailure !== undefined && stopFailure !== undefined) {
    throw new AggregateError([renderFailure, stopFailure], 'TUI render and teardown both failed.');
  }
  if (renderFailure !== undefined) throw renderFailure;
  if (stopFailure !== undefined) throw stopFailure;
}

export async function renderApp(options: IRenderOptions): Promise<void> {
  // ERR-001 / Library Neutrality Rule: NO process-level error policy here — process survival
  // is the product assembly's boundary (agent-cli installs the guards via onChannelReady).
  try {
    await options.keybindingsSource?.start();
    await renderStartedApp(options, (services) => ({
      createChannel: createInProcessChannelFactory(options, services),
    }));
  } finally {
    options.keybindingsSource?.dispose();
  }
}

/**
 * What the full TUI needs to attach to a session a host runs (a daemon) instead of building one.
 * Only presentation options: everything else belongs to the host's session.
 */
export interface IRenderAttachedAppOptions extends Pick<
  IRenderOptions,
  | 'cwd'
  | 'productDisplayName'
  | 'version'
  | 'cliAdapter'
  | 'screenReader'
  | 'screenReaderChannel'
  | 'screenReaderHint'
  | 'screenReaderPacing'
  | 'terminalCapabilities'
  | 'keybindingsSource'
  | 'themeRegistry'
  | 'reducedMotion'
  | 'reducedMotionOverride'
  | 'focusReporting'
  | 'promptHistorySource'
  | 'promptHistoryProject'
> {
  /** The session protocol connection; closing it belongs to the caller. */
  readonly connection: IAttachedSessionConnection;
  /** Shown as the session's label until the session reports its own name. */
  readonly sessionLabel: string;
  /** This terminal's driver id, from the attach handshake. */
  readonly driverId: string;
  /** Commands this terminal runs itself (`/shell`, `/theme`, ...); the host never sees them. */
  readonly clientCommands?: ITuiClientCommands;
  /**
   * How this terminal is on the session: `'drive'` (the default) sends prompts and answers questions;
   * `'observe'` only watches, and the host refuses anything else from it.
   */
  readonly mode?: 'drive' | 'observe';
  /** Print the screen-reader line; false when this process already printed it. Default true. */
  readonly announce?: boolean;
}

/**
 * Render the full TUI on a session the terminal is attached to over the session protocol. Leaving
 * only detaches: the session keeps running. Resolves `'user'` when the user leaves (`/exit`,
 * Ctrl-C) and `'closed'` when the connection closed.
 */
export async function renderAttachedApp(
  options: IRenderAttachedAppOptions,
): Promise<TAttachedSessionEnd> {
  let end: TAttachedSessionEnd = 'user';
  let endApp: () => void = () => undefined;
  const ended = new Promise<void>((resolve) => {
    endApp = resolve;
  });
  try {
    await options.keybindingsSource?.start();
    await renderStartedApp(options, (services) => {
      let channel: WireTuiChannel | undefined;
      return {
        // One channel for the App's life: a session switch is the host's, and the channel follows it.
        createChannel: () =>
          (channel ??= new WireTuiChannel({
            connection: options.connection,
            driverId: options.driverId,
            sessionName: options.sessionLabel,
            role: options.mode ?? 'drive',
            terminalHandoff: services.terminalHandoff,
            attention: services.attention,
            ...(options.clientCommands !== undefined
              ? { clientCommands: options.clientCommands, cwd: options.cwd }
              : { clientCommands: undefined }),
            onEnd: (reason) => {
              end = reason;
              endApp();
            },
          })),
        requestSessionSwitch: async (sessionId) => channel?.requestSessionSwitch(sessionId),
        ended,
      };
    });
  } finally {
    options.keybindingsSource?.dispose();
  }
  return end;
}

/** Presentation options the App shell reads, whichever kind of channel it renders. */
type TAppShellOptions = Pick<
  IRenderOptions,
  | 'cwd'
  | 'productDisplayName'
  | 'modelCommandToolPrefix'
  | 'providerOverride'
  | 'providerType'
  | 'modelId'
  | 'permissionMode'
  | 'version'
  | 'sessionStore'
  | 'resumeSessionId'
  | 'showSessionPickerOnStart'
  | 'initialInput'
  | 'initialInputOrigin'
  | 'startupUpdateNotice'
  | 'transportRegistry'
  | 'commandHostAdapters'
  | 'cliAdapter'
  | 'promptHistorySource'
  | 'promptHistoryProject'
  | 'themeRegistry'
  | 'reducedMotion'
  | 'reducedMotionOverride'
  | 'screenReader'
  | 'screenReaderPacing'
  | 'terminalCapabilities'
  | 'screenReaderChannel'
  | 'screenReaderHint'
  | 'keybindingsSource'
  | 'focusReporting'
> & {
  /** Print the screen-reader line. Default true; false when this process already printed it. */
  readonly announce?: boolean;
};

/** Terminal-wide services a channel is built with; they outlive every channel. */
export interface IChannelServices {
  readonly terminalHandoff: TerminalHandoffController;
  readonly attention: IAttentionSource;
}

/** Where the App's channels come from, and how a session switch and an app end are decided. */
interface IAppChannelComposition {
  readonly createChannel: (resumeSessionId?: string) => ITuiAppChannelPort;
  /** Present when the host switches sessions and the channel follows it. */
  readonly requestSessionSwitch?: (sessionId: string) => Promise<void>;
  /** Settles when the app ends without the user closing it (the connection closed). */
  readonly ended?: Promise<void>;
}

/**
 * The in-process factory: every channel builds its own session, and its own checkpoint store, from
 * the render options. A resumed session's store restores its active branch from the persisted pointer.
 */
export function createInProcessChannelFactory(
  options: IRenderOptions,
  services: IChannelServices,
): (resumeSessionId?: string) => ITuiAppChannelPort {
  // Issue #3081: the move is announced by the FIRST session only — a later switch to another
  // session (a `/fork` attach) did not move anywhere.
  let pendingWorkspaceMovedFrom = options.workspaceMovedFrom;
  return (resumeSessionId) => {
    const workspaceMovedFrom = pendingWorkspaceMovedFrom;
    pendingWorkspaceMovedFrom = undefined;
    const channel = new TuiInteractionChannel({
      ...toChannelOptions(options, resumeSessionId),
      ...(options.createEditCheckpointStore !== undefined
        ? { editCheckpointStore: options.createEditCheckpointStore() }
        : {}),
      ...(workspaceMovedFrom !== undefined ? { workspaceMovedFrom } : {}),
      terminalHandoff: services.terminalHandoff,
      attention: services.attention,
    });
    // Expose each live channel (incl. session-switch re-creations) to the embedding product,
    // e.g. for process-level error routing (ERR-001 G1).
    options.onChannelReady?.(channel);
    return channel;
  };
}

async function renderStartedApp(
  options: TAppShellOptions,
  compose: (services: IChannelServices) => IAppChannelComposition,
): Promise<void> {
  // CLI-2004: one resolved boolean drives Ink's own screen-reader support AND the React context
  // every component reads. Both are set here so they can never disagree.
  const screenReader = options.screenReader === true;
  if (options.announce !== false) {
    writeScreenReaderAnnouncement({
      enabled: screenReader,
      channel: options.screenReaderChannel,
      hint: options.screenReaderHint,
    });
  }
  const pacing = resolvePacing({ enabled: screenReader, overrides: options.screenReaderPacing });
  // SCREEN-2670: the pre-write park. Constructed only when the mode is on AND the interval is
  // non-zero, so with the mode off `stdout` is not passed at all and Ink defaults to
  // `process.stdout` — the object it keys its instance map by — exactly as today.
  const parked =
    screenReader && pacing.preparkMs > 0
      ? createParkedStdout({ stdout: process.stdout, preparkMs: pacing.preparkMs })
      : undefined;

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

  // SCREEN-1992: focus reporting is negotiated once for the process; the tracker outlives channels.
  // Screen-reader mode keeps the recap (a plain notice line) — only the row countdown tick is off.
  const focusReportingSupported = supportsFocusReporting({ override: options.focusReporting });
  const focusReporting = createFocusReportingWriter({ supported: () => focusReportingSupported });
  const attention = new AttentionTracker({
    focusReporting: focusReportingSupported,
    now: Date.now,
  });
  handoffController.setTerminalModeHooks({
    preSuspend: async () => {
      focusReporting.disable();
      // SCREEN-2670: nothing parked may land on top of the child's output.
      await parked?.drain();
    },
    postResume: () => focusReporting.enable(),
  });

  // Concrete framework creation has one composition boundary. React receives only the bounded port;
  // App owns which narrowed channel is active, while each channel owns its own lifecycle.
  const composition = compose({ terminalHandoff: handoffController, attention });
  let activeChannel: ITuiAppChannelPort | undefined;
  const createChannel = (resumeSessionId?: string): ITuiAppChannelPort => {
    activeChannel = composition.createChannel(resumeSessionId);
    return activeChannel;
  };

  // The startup quiet period sits between the confirmation line and the first frame, so a reader
  // finishes announcing the mode before the prompt lands. A keypress ends it early; `0` skips it.
  await awaitStartupQuietPeriod(pacing.startupQuietMs, process.stdin);

  // The filtering proxy is attached only now: the quiet period consumed its own keystroke above, and
  // from here on every byte reaches Ink through the proxy, minus the focus sequences.
  const stdin = new FocusReportingStdin(process.stdin, {
    negotiated: () => focusReporting.negotiated,
    onFocusIn: () => attention.focusIn(),
    onFocusOut: () => attention.focusOut(),
    onKeystroke: () => attention.keystroke(),
  });
  process.stdin.resume();
  // Requested only now, so a focus event the terminal answers with lands in the proxy, never in
  // the quiet period's keypress wait; the tracker's idle source runs until the first one arrives.
  focusReporting.enable();
  attention.start();

  const pacingPort = parked === undefined ? undefined : toPacingPort(parked);
  const tree = (
    <ProductDisplayNameProvider
      name={options.productDisplayName}
      modelCommandToolPrefix={options.modelCommandToolPrefix}
    >
      <KeybindingsProvider source={options.keybindingsSource}>
        <ScreenReaderProvider enabled={screenReader}>
          <TerminalCapabilitiesProvider overrides={options.terminalCapabilities}>
            <App
              cwd={options.cwd}
              createChannel={createChannel}
              {...(composition.requestSessionSwitch !== undefined
                ? { requestSessionSwitch: composition.requestSessionSwitch }
                : {})}
              providerOverride={options.providerOverride}
              providerType={options.providerType}
              modelId={options.modelId}
              permissionMode={options.permissionMode}
              version={options.version}
              sessionStore={options.sessionStore}
              resumeSessionId={options.resumeSessionId}
              showSessionPickerOnStart={options.showSessionPickerOnStart}
              initialInput={options.initialInput}
              initialInputOrigin={options.initialInputOrigin}
              startupUpdateNotice={options.startupUpdateNotice}
              transportRegistry={options.transportRegistry}
              pluginAdapter={options.commandHostAdapters?.plugin}
              cliAdapter={options.cliAdapter}
              promptHistorySource={options.promptHistorySource}
              promptHistoryProject={options.promptHistoryProject}
              themeRegistry={options.themeRegistry}
              reducedMotion={options.reducedMotion}
              reducedMotionOverride={options.reducedMotionOverride}
            />
          </TerminalCapabilitiesProvider>
        </ScreenReaderProvider>
      </KeybindingsProvider>
    </ProductDisplayNameProvider>
  );
  const instance = render(
    pacingPort === undefined ? (
      tree
    ) : (
      <ScreenReaderPacingProvider port={pacingPort}>{tree}</ScreenReaderPacingProvider>
    ),
    {
      exitOnCtrlC: false,
      isScreenReaderEnabled: screenReader,
      stdin: stdin.asInkStdin(),
      ...(parked === undefined ? {} : { stdout: parked.asInkStdout() }),
    },
  );
  // The controller needs the Ink instance to clear the frame before a handoff.
  handoffController.setInkInstance(instance);
  // Unmounting resolves `waitUntilExit`, so an app the host ended leaves the way a user exit does.
  void composition.ended?.then(() => instance.unmount());
  try {
    await waitForRenderAndStop(
      () => instance.waitUntilExit(),
      () => activeChannel,
    );
  } finally {
    // The last frame of a session must not be the one the park loses: drain before restoring.
    await parked?.flush();
    // Leave the terminal as it was found: no focus sequences after exit, no reader on stdin.
    handoffController.setTerminalModeHooks(undefined);
    focusReporting.disable();
    attention.dispose();
    stdin.detach();
    process.stdin.pause();
  }
}
