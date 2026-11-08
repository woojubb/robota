import type { IAttentionSource } from './attention/attention-tracker.js';
import type { TerminalHandoffController } from './terminal-handoff-controller.js';
import type {
  IAIProvider,
  IProviderDefinition,
  IToolWithEventService,
  TPermissionMode,
} from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IAutomaticMemoryConfig,
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  IFrameworkHost,
  IOutputStylePrompt,
  IOrgPolicy,
  IProviderErrorGuidance,
  IProjectSettingsPath,
  IHostSettingsSource,
  ICommandModule,
  ICreateSessionOptions,
  ILivePromptTracePort,
  IEditCheckpointStore,
  TInteractiveSessionOptions,
  IMemoryStore,
  IPromptHistoryOptions,
  IPerTurnRecallConfig,
  IRemoteCommandPolicy,
  IToolCallHandoffPolicy,
  TShellExecFn,
  TSubagentRunnerFactory,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

/**
 * The TUI channel's option surface.
 *
 * This lived inside the 698-line channel class, beside the code that consumes it. The
 * projection FROM it — `buildTuiSessionOptions` — already had its own module, so the surface and its
 * one projection now sit together and neither is buried in an implementation file. That matters for
 * this item specifically: a field added to the resolved preset has to be added here to reach the
 * interactive surface at all, and a surface nobody can find is a surface people forget.
 */
export interface ITuiInteractionChannelOptions {
  /** The platform the TUI's sessions run on; `{}` is a host with nothing to lend. */
  host: IFrameworkHost;
  livePromptTrace?: ILivePromptTracePort;
  /**
   * Provider definitions, forwarded to the session so `/provider switch` can construct the provider
   * it switches TO.
   *
   * Not optional-by-accident: without it the session holds an empty list, and the hot-swap fails with
   * "Unknown provider: <name>. Currently supported: " — an empty supported-list, which is both wrong
   * and unactionable. The definitions live in the composition root; the session cannot discover them.
   */
  providerDefinitions?: readonly IProviderDefinition[];
  cwd: string;
  provider: IAIProvider;
  providerErrorGuidance?: IProviderErrorGuidance;
  promptFileReferenceTag?: string;
  modelCommandToolPrefix?: string;
  subagentHookEnvironmentNames?: ICreateSessionOptions['subagentHookEnvironmentNames'];
  observerFailureWarningCode?: ICreateSessionOptions['observerFailureWarningCode'];
  commandHookShell?: string;
  /** Skip instruction files and plugin discovery (`--safe-mode`). */
  bare?: boolean;
  /** Run no hook the settings layers declare (`--safe-mode`). */
  skipConfiguredHooks?: boolean;
  /** Resolved organization policy forwarded to the interactive session. */
  orgPolicy?: IOrgPolicy;
  projectAccess?: TWorkspaceProjectAccess;
  projectSettingsPaths?: readonly IProjectSettingsPath[];
  baselinePermissionAllow?: readonly string[];
  /** Host-selected task-context root; absent means no framework task-directory scan. */
  taskContext?: { readonly enabled?: boolean; readonly dir?: string };
  contributionSources?: ICreateSessionOptions['contributionSources'];
  skillRoots?: ICreateSessionOptions['skillRoots'];
  userSettingsSources?: readonly IHostSettingsSource[];
  environment?: Readonly<Record<string, string | undefined>>;
  resolveProviderCredential?: import('@robota-sdk/agent-core').TProviderCredentialResolver;
  /**
   * Explicit authority- and permission-backed edit checkpoint capability for this channel's one
   * session. Never shared with another channel's session: a store holds one turn in progress.
   */
  editCheckpointStore?: IEditCheckpointStore;
  /** The host's way to build each external-event grant's verifier; absent, no grant opens. */
  externalEventVerifierFactory?: TInteractiveSessionOptions['externalEventVerifierFactory'];
  /** The run's grant history, shared by every session this TUI binds. */
  externalEventGrantHistory?: TInteractiveSessionOptions['externalEventGrantHistory'];
  /**
   * The resolved model id (the same value the status line displays). Forwarded to the session so an
   * explicit `--model` override reaches the provider chat call instead of being silently replaced by the
   * session's default model.
   */
  model?: string;
  /** Resolved provider-neutral response style. */
  outputStyle?: IOutputStylePrompt;
  /** Resolved preset effort, threaded to the session's `effort` seam. */
  effort?: ICreateSessionOptions['effort'];
  temperature?: number;
  maxOutputTokens?: number;
  /** Preset prompt seed, distinct from the replacing `systemPrompt` option. */
  presetSystemPrompt?: string;
  responseFormat?: ICreateSessionOptions['responseFormat'];
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  disableSessionLoops?: boolean;
  resolveDefaultLoopPrompt?: () => string;
  resumeSessionId?: string;
  /**
   * The SHA-256 of the stored record bytes the person accepted as theirs for `resumeSessionId`.
   * Projected into the session only when set; a channel without one accepts nothing unverified.
   */
  acceptedDigest?: string;
  forkSession?: boolean;
  /** This channel's session is the target of a `/cd` from this directory. */
  workspaceMovedFrom?: string;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Forwarded to `ICreateSessionOptions.toolCallHandoff`. */
  toolCallHandoff?: IToolCallHandoffPolicy;
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Composition-root-contributed subagent definitions (merged capability packs). */
  agentDefinitions?: readonly IAgentDefinition[];
  agentDefinitionRoots?: readonly string[];
  pluginDirectories?: { readonly user?: string; readonly project?: string };
  /**
   * Tools contributed by the composition root (the capability packs `assembleProduct` merged)
   * and, when the profile hands the packs the whole tool surface, the suppressed framework default tier
   * (`defaultTools: []`). Forwarded to the session's tool-composition seam; absent ⇒ unchanged.
   */
  additionalTools?: IToolWithEventService[];
  defaultTools?: readonly IToolWithEventService[];
  /** The sandbox the shell tools run under, so the session can let a confined command skip the prompt. */
  sandboxClient?: ICreateSessionOptions['sandboxClient'];
  toolExecutionPolicy?: ICreateSessionOptions['toolExecutionPolicy'];
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
  /** Optional remote-command policy (allow-by-default; a transport-origin command runs as a local one). */
  remoteCommandPolicy?: IRemoteCommandPolicy;
  transportRegistry?: ITransportRegistryView;
  /** Bind concrete transports to each newly constructed session before registry startup. */
  bindTransports?: (session: IInteractiveSession) => void | Promise<void>;
  language?: string;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
  agentName?: string;
  /** Active preset id selected at startup (runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean;
  /** Process-shared terminal-handoff controller (the TUI implementation of ITerminalHandoff). */
  terminalHandoff?: TerminalHandoffController;
  /** The terminal's attention level; absent ⇒ no interval recap. */
  attention?: IAttentionSource;
  /**
   * Optional durable-memory store injected by the surface (agent-cli). Forwarded into
   * `buildRuntimeSession`; absent ⇒ memory OFF (today's behavior). Enablement/policy is surface-owned.
   */
  memoryStore?: IMemoryStore;
  /** Optional automatic post-turn capture policy (absent ⇒ capture OFF). */
  automaticMemory?: IAutomaticMemoryConfig;
  /** Optional per-turn recall policy (absent ⇒ recall OFF, startup-only injection). */
  recallMemory?: IPerTurnRecallConfig;
  /** Observe TUI-owned session-event rendering failures without failing the committed operation. */
  onSessionEventDeliveryError?: (error: Error, event: TInteractiveEventName) => void;
  /**
   * The resolved screen-reader mode. A PRESENTATION field — it changes nothing about the
   * session and is deliberately NOT projected into `buildTuiSessionOptions`; it is carried here so
   * the render-options → channel-options projection is complete and the drop hazard is
   * asserted rather than assumed. Absent ⇒ OFF.
   */
  screenReader?: boolean;
  /** The session-side prompt-history writer and project key; absent ⇒ nothing recorded. */
  promptHistory?: IPromptHistoryOptions | undefined;
}
