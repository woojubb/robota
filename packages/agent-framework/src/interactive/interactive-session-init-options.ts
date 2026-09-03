/**
 * The INTERNAL async-init option shape.
 *
 * Split out of `interactive-session-options.ts` by ARCH-040. That file held three interfaces
 * restating one option list — the public standard arm, the injected arm, and this — so every preset
 * field had to be added three times, and the anti-monolith floor refused the fourth addition. The
 * split is by responsibility: what a CALLER may pass lives there, what the async init hands onward
 * lives here.
 *
 * Re-exported from the original module, so no consumer has to know it moved.
 */

import type { IInteractiveSessionStore } from './session-persistence.js';
import type { TInteractivePermissionHandler } from './types.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { TSessionResponseFormat } from '../assembly/create-session-types.js';
import type { ICreateSessionOptions } from '../assembly/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { IEditCheckpointRecorder } from '../checkpoints/edit-checkpoint-types.js';
import type { IOrgPolicy } from '../command-api/org-policy/org-policy-types.js';
import type {
  ICommandHostAdapters,
  ICommandModule,
  ICommandResult,
  IRemoteCommandPolicy,
  ISystemCommandSemanticRoles,
} from '../commands/index.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { IAutomaticMemoryConfig } from '../memory/automatic-memory-types.js';
import type { IMemoryStore, IPerTurnRecallConfig } from '../memory/types.js';
import type { IReversibleExecutionOptions } from '../reversible-execution/index.js';
import type { TSubagentRunnerFactory } from '../subagents/index.js';
import type { TShellExecFn } from '../utils/skill-prompt.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';
import type { TGuardrail } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IContextWindowState,
  IToolWithEventService,
  IUserInteraction,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';
import type { ICompactEvent } from '@robota-sdk/agent-interface-session';
import type { Session } from '@robota-sdk/agent-session';
import type { ISessionLogSink } from '@robota-sdk/agent-session';
import type { IRetrievalAdapter } from '@robota-sdk/agent-tools';
import type { ISandboxClient, IWorkspaceManifest } from '@robota-sdk/agent-tools';

/** Standard construction: cwd + provider. Config/context loaded internally. */

export interface IInitOptions {
  cwd: string;
  provider: IAIProvider;
  projectAccess?: TWorkspaceProjectAccess;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  /** CMD-005: unified ask renderer, forwarded into the session as the model-question tool seam. */
  askHandler?: IUserInteraction['ask'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Explicit session-log sink; absence disables diagnostic project logging. */
  sessionLogSink?: ISessionLogSink;
  /** Trusted host-only path projection for hook compatibility. */
  transcriptPath?: string;
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
  allowedTools?: readonly string[];
  /** Denied tool names — added to permissions.deny. denied > allowed. */
  deniedTools?: readonly string[];
  /** Override the model from config. When set, takes precedence over config.provider.model. */
  model?: string;
  /**
   * Reasoning-effort dial resolved from the active preset (PRESET-008). ARCH-013: this key did not
   * exist, so a preset's `effort` reached nothing at startup while `/preset` applied it mid-session.
   * Typed FROM the seam, not re-declared beside it — that is how the two drift apart again.
   */
  effort?: ICreateSessionOptions['effort'];
  temperature?: number;
  maxOutputTokens?: number;
  /** Text to append to the system prompt. */
  appendSystemPrompt?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  /** Replace the entire system prompt with this string. Takes precedence over the default builder. */
  systemPrompt?: string;
  presetSystemPrompt?: string;
  /** Override config language (e.g., "ko", "en"). Injected into system prompt. */
  language?: string;
  /** Runtime-composed background task runners. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** ARCH-005: composition-root-contributed subagent definitions (see the standard options). */
  agentDefinitions?: readonly IAgentDefinition[];
  /** Optional command modules composed into this session. */
  commandModules?: readonly ICommandModule[];
  /** Model-visible command descriptors derived from the composed command executor. */
  commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Role projection resolved once from the selected executable commands. */
  commandSemanticRoles?: ISystemCommandSemanticRoles;
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
  /** ARCH-033: the name a child process uses to rebuild a sandbox like this one. */
  sandboxType?: string;
  /**
   * SELFHOST-008: optional durable-memory store. When present, startup-memory injection reads through
   * it; absence leaves project memory inaccessible.
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
  /**
   * ARCH-006: REPLACES the framework's `createDefaultTools()` tier; `[]` suppresses every framework
   * default so a product's capability packs can own the whole tool surface. Mirrors NEUT-003's
   * `builtInAgents` seam for subagents. Absent ⇒ unchanged behavior.
   */
  defaultTools?: readonly IToolWithEventService[];
  /** SELFHOST-005 guardrail REGISTRY (name → function). ARCH-013 S3; see create-session-projection. */
  guardrails?: Record<string, TGuardrail>;
  /** SELFHOST-003 retrieval adapter gating `CodebaseRetrieval`. ARCH-013 S3; same seam as above. */
  retrievalAdapter?: IRetrievalAdapter;
  /** Request structured output from the provider for this session (issue #2056: incl. `json_schema`). */
  responseFormat?: TSessionResponseFormat;
}
