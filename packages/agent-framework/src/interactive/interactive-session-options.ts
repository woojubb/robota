/**
 * Public option interfaces for InteractiveSession construction and configuration.
 *
 * IInteractiveSessionStandardOptions: standard construction (cwd + provider).
 * IInteractiveSessionInjectedOptions: test/advanced injection of a pre-built session.
 * IInitOptions: internal async init shape passed to createInteractiveSession().
 */

import type { IInteractiveSessionStore } from './session-persistence.js';
import type { TInteractivePermissionHandler } from './types.js';
import type { ICreateSessionOptions } from '../assembly/index.js';
import type { IBackgroundTaskRunner } from '../background-tasks/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { IEditCheckpointRecorder } from '../checkpoints/edit-checkpoint-types.js';
import type { IOrgPolicy } from '../command-api/org-policy/org-policy-types.js';
import type {
  ICommandHostAdapters,
  ICommandModule,
  ICommandResult,
  IRemoteCommandPolicy,
} from '../commands/index.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { IAutomaticMemoryConfig } from '../memory/automatic-memory-types.js';
import type { IMemoryStore, IPerTurnRecallConfig } from '../memory/types.js';
import type { IReversibleExecutionOptions } from '../reversible-execution/index.js';
import type { TSubagentRunnerFactory } from '../subagents/index.js';
import type { TShellExecFn } from '../utils/skill-prompt.js';
import type {
  IAIProvider,
  IContextWindowState,
  IToolWithEventService,
  IUserInteraction,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-transport';
import type { ICompactEvent } from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';
import type { ISandboxClient, IWorkspaceManifest } from '@robota-sdk/agent-tools';

/** Standard construction: cwd + provider. Config/context loaded internally. */
export interface IInteractiveSessionStandardOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: IInteractiveSessionStore;
  sessionName?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Skip AGENTS.md/CLAUDE.md loading and plugin discovery. */
  bare?: boolean;
  /** Pre-approved tool names passed to createSession. */
  allowedTools?: string[];
  /** Denied tool names — added to permissions.deny. denied > allowed. */
  deniedTools?: string[];
  /** Override the model from config. When set, takes precedence over config.provider.model. */
  model?: string;
  /** Text to append to the system prompt. */
  appendSystemPrompt?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  /** Replace the entire system prompt with this string. Takes precedence over the default builder. */
  systemPrompt?: string;
  /** Override config language (e.g., "ko", "en"). Injected into system prompt. */
  language?: string;
  /** Runtime-composed background task runners. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Optional command modules composed into this session. */
  commandModules?: readonly ICommandModule[];
  /** Host adapters available to composed command modules. */
  commandHostAdapters?: ICommandHostAdapters;
  /** Shell exec function for preprocessing `` !`cmd` `` patterns in skills — injected from composition root. */
  shellExec?: TShellExecFn;
  /**
   * REMOTE-006: optional command-execution policy for remote-origin (`source==='remote'`) commands arriving over a
   * transport. **Allow by default** — local == remote; injected only so a consumer can opt into a restriction.
   */
  remoteCommandPolicy?: IRemoteCommandPolicy;
  /**
   * TERM-001: transport-provided terminal-handoff capability. When present, the session can hand the
   * real terminal to a child process (e.g. `/shell`, `$EDITOR`) and restore the display. Absent /
   * `canHandoffTerminal === false` for transports with no interactive TTY (headless).
   */
  terminalHandoff?: ITerminalHandoff;
  /**
   * CMD-004: transport-provided "ask the user" handler. When present, commands can solicit a
   * structured answer (confirm/select/multi/text) through the interaction channel. Absent for
   * non-interactive transports — the session then treats an ask as `cancelled`, never a silent guess.
   */
  askHandler?: IUserInteraction['ask'];
  /** Model-visible command descriptors derived from the composed command executor. */
  commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Provider definitions for hot-swap via /provider switch. */
  providerDefinitions?: readonly import('@robota-sdk/agent-core').IProviderDefinition[];
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Preloaded config to avoid duplicate discovery when caller needs it too. */
  config?: IResolvedConfig;
  /** Opt-in local-first reversible execution policy for write/shell tools. */
  reversibleExecution?: IReversibleExecutionOptions;
  /** Optional provider sandbox client used by sandbox-aware built-in tools. */
  sandboxClient?: ISandboxClient;
  /**
   * SELFHOST-008: optional durable-memory store injected by the surface. Threads to startup-memory
   * injection; absent, the neutral filesystem reference adapter is the default (memory unchanged).
   */
  memoryStore?: IMemoryStore;
  /**
   * SELFHOST-008 P2: optional automatic post-turn memory-capture policy. When present, the dormant
   * capture pipeline is wired into the live turn (awaited in the controller's finally before persist),
   * gated by this policy (default reference policy = approval_required = queue). Absent ⇒ capture OFF.
   */
  automaticMemory?: IAutomaticMemoryConfig;
  /**
   * SELFHOST-008 P3: optional per-turn durable-memory recall policy. When present, each turn recalls
   * query-relevant memory (query = the turn input) and injects it EPHEMERALLY into that turn's model call
   * (never persisted). Absent ⇒ recall OFF (startup-only injection, unchanged). The budget is surface-owned.
   */
  recallMemory?: IPerTurnRecallConfig;
  /** Fresh-session workspace manifest applied through the sandbox client. */
  workspaceManifest?: IWorkspaceManifest;
  /** Sandbox target root for workspace manifest entries. Defaults to /workspace. */
  sandboxWorkspaceRoot?: string;
  /** Provider sandbox snapshot id to restore before replaying saved messages. */
  sandboxSnapshotId?: string;
  /** Name reported to the underlying Robota agent config. Defaults to 'agent'. */
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean | string;
  /** Organization policy for enforcing provider restrictions, command blocks, and API key rules. */
  orgPolicy?: IOrgPolicy;
  /** Additional tools registered alongside the default CLI tools. */
  additionalTools?: IToolWithEventService[];
  /** Request structured output from the provider for this session. */
  responseFormat?: { type: 'text' | 'json_object' };
}

/** Test/advanced construction: inject pre-built session directly. */
export interface IInteractiveSessionInjectedOptions {
  session: Session;
  cwd?: string;
  provider?: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: IInteractiveSessionStore;
  sessionName?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Optional command modules composed into this injected session. */
  commandModules?: readonly ICommandModule[];
  /** Host adapters available to composed command modules. */
  commandHostAdapters?: ICommandHostAdapters;
  /** TERM-001: transport-provided terminal-handoff capability (see standard options). */
  terminalHandoff?: ITerminalHandoff;
  /** CMD-004: transport-provided "ask the user" handler (see standard options). */
  askHandler?: IUserInteraction['ask'];
}

/** Union of standard and injected construction options. */
export type TInteractiveSessionOptions =
  IInteractiveSessionStandardOptions | IInteractiveSessionInjectedOptions;

/** Internal async init options (not re-exported). */
export interface IInitOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  /** CMD-005: unified ask renderer, forwarded into the session as the model-question tool seam. */
  askHandler?: IUserInteraction['ask'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  resumeSessionId?: string;
  forkSession?: boolean;
  onTextDelta: (delta: string) => void;
  onContextUpdate?: (state: IContextWindowState) => void;
  onCompactEvent?: (event: ICompactEvent) => void;
  onToolExecution: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }) => void;
  /** Skip AGENTS.md/CLAUDE.md loading and plugin discovery. */
  bare?: boolean;
  /** Pre-approved tool names passed to createSession. */
  allowedTools?: string[];
  /** Denied tool names — added to permissions.deny. denied > allowed. */
  deniedTools?: string[];
  /** Override the model from config. When set, takes precedence over config.provider.model. */
  model?: string;
  /** Text to append to the system prompt. */
  appendSystemPrompt?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  /** Replace the entire system prompt with this string. Takes precedence over the default builder. */
  systemPrompt?: string;
  /** Override config language (e.g., "ko", "en"). Injected into system prompt. */
  language?: string;
  /** Runtime-composed background task runners. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Optional command modules composed into this session. */
  commandModules?: readonly ICommandModule[];
  /** Model-visible command descriptors derived from the composed command executor. */
  commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Preloaded config to avoid duplicate discovery when caller needs it too. */
  config?: IResolvedConfig;
  /** Recorder used to snapshot files before Write/Edit tools mutate them. */
  editCheckpointRecorder?: IEditCheckpointRecorder;
  /** Opt-in local-first reversible execution policy for write/shell tools. */
  reversibleExecution?: IReversibleExecutionOptions;
  /** Optional provider sandbox client used by sandbox-aware built-in tools. */
  sandboxClient?: ISandboxClient;
  /**
   * SELFHOST-008: optional durable-memory store. When present, startup-memory injection reads through
   * it; absent, the neutral filesystem reference adapter is the default (memory works unchanged).
   */
  memoryStore?: IMemoryStore;
  /** Fresh-session workspace manifest applied through the sandbox client. */
  workspaceManifest?: IWorkspaceManifest;
  /** Sandbox target root for workspace manifest entries. Defaults to /workspace. */
  sandboxWorkspaceRoot?: string;
  /** Provider sandbox snapshot id to restore before replaying saved messages. */
  sandboxSnapshotId?: string;
  /** Name reported to the underlying Robota agent config. Defaults to 'agent'. */
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean | string;
  /** Additional tools registered alongside the default CLI tools. */
  additionalTools?: IToolWithEventService[];
  /** Request structured output from the provider for this session. */
  responseFormat?: { type: 'text' | 'json_object' };
}
