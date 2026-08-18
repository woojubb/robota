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
  ICommandModule,
  ICreateSessionOptions,
  IMemoryStore,
  IPerTurnRecallConfig,
  IRemoteCommandPolicy,
  TShellExecFn,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-framework';
import type { CommandRegistry } from '@robota-sdk/agent-framework';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
  ITransportRegistryView,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-transport';

/**
 * The TUI channel's option surface.
 *
 * ARCH-013: this lived inside the 698-line channel class, beside the code that consumes it. The
 * projection FROM it — `buildTuiSessionOptions` — already had its own module, so the surface and its
 * one projection now sit together and neither is buried in an implementation file. That matters for
 * this item specifically: a field added to the resolved preset has to be added here to reach the
 * interactive surface at all, and a surface nobody can find is a surface people forget.
 */
export interface ITuiInteractionChannelOptions {
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
  /**
   * CLI-076: the resolved model id (the same value the status line displays). Forwarded to the session so an
   * explicit `--model` override reaches the provider chat call instead of being silently replaced by the
   * session's default model.
   */
  model?: string;
  /** ARCH-013: resolved preset effort, threaded to the session's `effort` seam. */
  effort?: ICreateSessionOptions['effort'];
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  forkSession?: boolean;
  sessionName?: string;
  onAutoNamed?: (name: string) => void;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** ARCH-005: composition-root-contributed subagent definitions (merged capability packs). */
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
  /** REMOTE-006: optional remote-command policy (allow-by-default; a transport-origin command runs as a local one). */
  remoteCommandPolicy?: IRemoteCommandPolicy;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  language?: string;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean;
  /** TERM-002: process-shared terminal-handoff controller (the TUI implementation of ITerminalHandoff). */
  terminalHandoff?: TerminalHandoffController;
  /**
   * SELFHOST-008 P6: optional durable-memory store injected by the surface (agent-cli). Forwarded into
   * `buildRuntimeSession`; absent ⇒ memory OFF (today's behavior). Enablement/policy is surface-owned.
   */
  memoryStore?: IMemoryStore;
  /** SELFHOST-008 P6: optional automatic post-turn capture policy (absent ⇒ capture OFF). */
  automaticMemory?: IAutomaticMemoryConfig;
  /** SELFHOST-008 P6: optional per-turn recall policy (absent ⇒ recall OFF, startup-only injection). */
  recallMemory?: IPerTurnRecallConfig;
  /** Observe TUI-owned session-event rendering failures without failing the committed operation. */
  onSessionEventDeliveryError?: (error: Error, event: TInteractiveEventName) => void;
}
