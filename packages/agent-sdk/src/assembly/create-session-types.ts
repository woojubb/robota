import type {
  IAIProvider,
  IContextWindowState,
  IToolWithEventService,
  IHookTypeExecutor,
  TPermissionMode,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type {
  Session,
  ISessionOptions,
  ITerminalOutput,
  ICompactEvent,
  TPermissionHandler,
  ISessionLogger,
} from '@robota-sdk/agent-sessions';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IProjectInfo } from '../context/project-detector.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import type { ISandboxClient } from '@robota-sdk/agent-tools';
import type { TSubagentRunnerFactory } from '../subagents/in-process-subagent-runner.js';
import type { IInteractiveSessionStore } from '../interactive/session-persistence.js';
import type { ICommandResult } from '../commands/system-command.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { IEditCheckpointRecorder } from '../checkpoints/edit-checkpoint-types.js';
import type { IReversibleExecutionOptions } from '../reversible-execution/index.js';
import type { TProviderFactory } from '../hooks/prompt-executor.js';
import type { TSessionFactory } from '../hooks/agent-executor.js';
import type { IBackgroundTaskRunner } from '../background-tasks/index.js';

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
  ) => Promise<boolean>;
  /** Additional tools to register beyond the defaults (e.g. agent-tool) */
  additionalTools?: IToolWithEventService[];
  /** Additional background task runners composed by the runtime shell. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. Defaults to the SDK in-process runner. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Enable agent tool, agent definitions, and subagent runtime wiring for this session. */
  enableAgentRuntime?: boolean;
  /** Callback when a tool starts or finishes execution — enables real-time tool display in UI */
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
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
  /** Text to append to the generated system prompt. */
  appendSystemPrompt?: string;
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
}

/** Result of createSession — session instance plus a system-message rebuilder for context refresh. */
export interface ICreateSessionResult {
  session: Session;
  /**
   * Rebuild the system message using updated context strings.
   * Called by staleness detection when AGENTS.md or CLAUDE.md files change between turns.
   */
  rebuildSystemMessage: (agentsMd: string, claudeMd: string) => string;
}
