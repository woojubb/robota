import type { IBackgroundTaskRunner } from '../background-tasks/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { IEditCheckpointRecorder } from '../checkpoints/edit-checkpoint-types.js';
import type { ICommandResult } from '../commands/system-command.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IProjectInfo } from '../context/project-detector.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import type { TSessionFactory } from '../hooks/agent-executor.js';
import type { TProviderFactory } from '../hooks/prompt-executor.js';
import type { IInteractiveSessionStore } from '../interactive/session-persistence.js';
import type { IReversibleExecutionOptions } from '../reversible-execution/index.js';
import type { TSubagentRunnerFactory } from '../subagents/in-process-subagent-runner.js';
import type {
  IAIProvider,
  IContextWindowState,
  IToolWithEventService,
  IHookTypeExecutor,
  TPermissionMode,
  TModelEffort,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type {
  Session,
  ISessionOptions,
  ITerminalOutput,
  ICompactEvent,
  TPermissionHandler,
  TPermissionResult,
  ISessionLogger,
} from '@robota-sdk/agent-session';
import type { ISandboxClient } from '@robota-sdk/agent-tools';

export type TAutoCompactThreshold = number | false;
export type TSessionOptionsWithAutoCompact = ISessionOptions & {
  autoCompactThreshold?: TAutoCompactThreshold;
};
export type TSessionConstructorWithAutoCompact = new (
  options: TSessionOptionsWithAutoCompact,
) => Session;

/** Options for the createSession factory */
export interface ICreateSessionOptions {
  /** Resolved CLI configuration (model, API key, permissions) */
  config: IResolvedConfig;
  /** Working directory used for project context, skills, and agent definitions. */
  cwd?: string;
  /** Loaded AGENTS.md / CLAUDE.md context */
  context: ILoadedContext;
  /** Terminal I/O for permission prompts */
  terminal: ITerminalOutput;
  /** Project metadata for system prompt */
  projectInfo?: IProjectInfo;
  /** Initial permission mode (defaults to config.defaultTrustLevel → mode mapping) */
  permissionMode?: TPermissionMode;
  /** Maximum number of agentic turns per run() call. Undefined = unlimited. */
  maxTurns?: number;
  /** Optional session store for persistence */
  sessionStore?: IInteractiveSessionStore;
  /** Inject a pre-constructed AI provider (used by tests to avoid real API calls) */
  provider?: IAIProvider;
  /** Custom permission handler (overrides terminal-based prompts, used by Ink UI) */
  permissionHandler?: TPermissionHandler;
  /** Callback for text deltas — enables streaming text to the UI in real-time */
  onTextDelta?: (delta: string) => void;
  /** Callback when context window usage is refreshed */
  onContextUpdate?: (state: IContextWindowState) => void;
  /** Custom prompt-for-approval function (injected from CLI) */
  promptForApproval?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<TPermissionResult>;
  /** Additional tools to register beyond the defaults (e.g. agent-tool) */
  additionalTools?: IToolWithEventService[];
  /** Additional background task runners composed by the runtime shell. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. Defaults to the SDK in-process runner. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Enable agent tool, agent definitions, and subagent runtime wiring for this session. */
  enableAgentRuntime?: boolean;
  /**
   * Preset execution capability: when true the assembly turns on `enableAgentRuntime`
   * so subagent/background dispatch is active for this session. Threaded from the
   * preset's `enableParallelSubagents` flag.
   */
  enableParallelSubagents?: boolean;
  /**
   * Preset execution capability: when true the agent runs a post-task self-verification
   * step. Threaded onto the assembly options so executor/framework can consume it.
   */
  selfVerification?: boolean;
  /** Callback when a tool starts or finishes execution — enables real-time tool display in UI */
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
    executionId?: string;
  }) => void;
  /** Callback when context is compacted */
  onCompact?: (summary: string) => void;
  /** Callback with structured compaction metadata */
  onCompactEvent?: (event: ICompactEvent) => void;
  /** Instructions to include in the compaction prompt (e.g. from CLAUDE.md) */
  compactInstructions?: string;
  /** Auto-compact threshold as a 0-1 fraction. Set false to disable automatic compaction. */
  autoCompactThreshold?: TAutoCompactThreshold;
  /** Custom system prompt builder function */
  systemPromptBuilder?: (params: ISystemPromptParams) => string;
  /** Custom tool descriptions for the system prompt */
  toolDescriptions?: string[];
  /** Session logger — injected for pluggable session event logging. */
  sessionLogger?: ISessionLogger;
  /** Provider factory for prompt hook executors (DI). */
  providerFactory?: TProviderFactory;
  /** Session factory for agent hook executors (DI). */
  sessionFactory?: TSessionFactory;
  /** Additional hook type executors beyond the defaults (prompt, agent). */
  additionalHookExecutors?: IHookTypeExecutor[];
  /** Override session ID (used when resuming a session to reuse the original ID) */
  sessionId?: string;
  /** Pre-approved tool names — added to permissions.allow as ToolName(*) patterns. */
  allowedTools?: string[];
  /** Denied tool names — added to permissions.deny as ToolName(*) patterns. denied > allowed. */
  deniedTools?: string[];
  /** Override the model from config. When set, takes precedence over config.provider.model. */
  model?: string;
  /**
   * Reasoning-effort dial for this session, threaded to the provider request builder.
   * Resolved from a preset's `effort` (PRESET-008). When unset, the framework→provider
   * seam defaults it to `'high'`. Native-effort providers map it onto their request
   * parameter; providers without native effort ignore it as a documented no-op.
   */
  effort?: TModelEffort;
  /** Text to append to the generated system prompt. */
  appendSystemPrompt?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Model-visible command descriptors. */
  commandDescriptors?: ICapabilityDescriptor[];
  /** Recorder used to snapshot files before Write/Edit tools mutate them. */
  editCheckpointRecorder?: IEditCheckpointRecorder;
  /** Opt-in local-first reversible execution policy for write/shell tools. */
  reversibleExecution?: IReversibleExecutionOptions;
  /** Optional provider sandbox client used by sandbox-aware built-in tools. */
  sandboxClient?: ISandboxClient;
  /** Name reported to the underlying Robota agent config. Defaults to 'agent'. */
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Request structured output from the provider for this session. */
  responseFormat?: { type: 'text' | 'json_object' };
}

/** Result of createSession — session instance plus a system-message rebuilder for context refresh. */
export interface ICreateSessionResult {
  session: Session;
  /**
   * Rebuild the system message using updated context strings.
   * Called by staleness detection when AGENTS.md or CLAUDE.md files change between turns.
   * PRESET-014: an optional `overrides.persona` re-applies a preset persona to the live prompt;
   * the override is retained for subsequent (override-less) rebuilds.
   */
  rebuildSystemMessage: (
    agentsMd: string,
    claudeMd: string,
    overrides?: { persona?: string },
  ) => string;
}
