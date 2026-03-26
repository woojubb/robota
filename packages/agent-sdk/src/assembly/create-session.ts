/**
 * Session factory — assembles a fully-configured Session from config, context,
 * tools, and provider.
 *
 * This is the main entry point for creating sessions. It wires together
 * the provider, tools, system prompt, and configuration that Session now
 * expects as pre-constructed dependencies.
 */

import type { IAIProvider, IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import { PromptExecutor } from '../hooks/prompt-executor.js';
import { AgentExecutor } from '../hooks/agent-executor.js';
import type { TProviderFactory } from '../hooks/prompt-executor.js';
import type { TSessionFactory } from '../hooks/agent-executor.js';
import { Session } from '@robota-sdk/agent-sessions';
import type {
  ITerminalOutput,
  TPermissionHandler,
  ISessionLogger,
} from '@robota-sdk/agent-sessions';
import type { SessionStore } from '@robota-sdk/agent-sessions';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IProjectInfo } from '../context/project-detector.js';
import { buildSystemPrompt } from '../context/system-prompt-builder.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from './create-tools.js';

import { createAgentTool, storeAgentToolDeps } from '../tools/agent-tool.js';
import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';

/** Options for the createSession factory */
export interface ICreateSessionOptions {
  /** Resolved CLI configuration (model, API key, permissions) */
  config: IResolvedConfig;
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
  sessionStore?: SessionStore;
  /** Inject a pre-constructed AI provider (used by tests to avoid real API calls) */
  provider?: IAIProvider;
  /** Custom permission handler (overrides terminal-based prompts, used by Ink UI) */
  permissionHandler?: TPermissionHandler;
  /** Callback for text deltas — enables streaming text to the UI in real-time */
  onTextDelta?: (delta: string) => void;
  /** Custom prompt-for-approval function (injected from CLI) */
  promptForApproval?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  /** Additional tools to register beyond the defaults (e.g. agent-tool) */
  additionalTools?: IToolWithEventService[];
  /** Callback when a tool starts or finishes execution — enables real-time tool display in UI */
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
  }) => void;
  /** Callback when context is compacted */
  onCompact?: (summary: string) => void;
  /** Instructions to include in the compaction prompt (e.g. from CLAUDE.md) */
  compactInstructions?: string;
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
}

/**
 * Create a fully-configured Session instance.
 *
 * Assembles provider, tools, and system prompt, then passes them
 * to Session as pre-constructed dependencies.
 */
export function createSession(options: ICreateSessionOptions): Session {
  if (!options.provider) {
    throw new Error(
      'provider is required. SDK is provider-neutral — consumer must create and pass a provider instance.',
    );
  }
  const provider = options.provider;

  const defaultTools = createDefaultTools();
  const tools = [...defaultTools, ...(options.additionalTools ?? [])];

  // Wire agent tool — create a fresh instance with deps captured in closure.
  // Must happen after default tools are assembled so sub-agents inherit the full set.
  const agentLoader = new AgentDefinitionLoader(process.cwd());

  // Build hook type executors early so they can be forwarded to subagents.
  const hookTypeExecutors: IHookTypeExecutor[] = [];
  if (options.providerFactory) {
    hookTypeExecutors.push(
      new PromptExecutor({
        providerFactory: options.providerFactory,
        defaultModel: options.config.provider.model,
      }),
    );
  }
  if (options.sessionFactory) {
    hookTypeExecutors.push(
      new AgentExecutor({
        sessionFactory: options.sessionFactory,
      }),
    );
  }
  if (options.additionalHookExecutors) {
    hookTypeExecutors.push(...options.additionalHookExecutors);
  }

  const agentToolDeps = {
    config: options.config,
    context: options.context,
    tools,
    terminal: options.terminal,
    provider,
    permissionMode: options.permissionMode,
    permissionHandler: options.permissionHandler,
    hooks: options.config.hooks as Record<string, unknown> | undefined,
    hookTypeExecutors: hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
    onTextDelta: options.onTextDelta,
    onToolExecution: options.onToolExecution,
    customAgentRegistry: (name: string) => agentLoader.getAgent(name),
  };
  tools.push(createAgentTool(agentToolDeps));

  const buildPrompt = options.systemPromptBuilder ?? buildSystemPrompt;
  const systemMessage = buildPrompt({
    agentsMd: options.context.agentsMd,
    claudeMd: options.context.claudeMd,
    toolDescriptions: options.toolDescriptions ?? DEFAULT_TOOL_DESCRIPTIONS,
    trustLevel: options.config.defaultTrustLevel,
    projectInfo: options.projectInfo ?? { type: 'unknown', language: 'unknown' },
    cwd: process.cwd(),
    language: options.config.language,
  });

  // Merge default allow patterns for config folders with user-configured permissions
  const defaultAllow = [
    'Read(.agents/**)',
    'Read(.claude/**)',
    'Read(.robota/**)',
    'Glob(.agents/**)',
    'Glob(.claude/**)',
    'Glob(.robota/**)',
  ];
  const mergedPermissions = {
    allow: [...defaultAllow, ...(options.config.permissions.allow ?? [])],
    deny: options.config.permissions.deny ?? [],
  };

  const session = new Session({
    tools,
    provider,
    systemMessage,
    terminal: options.terminal,
    permissions: mergedPermissions,
    hooks: options.config.hooks,
    permissionMode: options.permissionMode,
    defaultTrustLevel: options.config.defaultTrustLevel,
    model: options.config.provider.model,
    maxTurns: options.maxTurns,
    sessionStore: options.sessionStore,
    sessionId: options.sessionId,
    permissionHandler: options.permissionHandler,
    onTextDelta: options.onTextDelta,
    onToolExecution: options.onToolExecution,
    promptForApproval: options.promptForApproval,
    onCompact: options.onCompact,
    compactInstructions: options.compactInstructions ?? options.context.compactInstructions,
    sessionLogger: options.sessionLogger,
    hookTypeExecutors: hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
  });

  // Store deps keyed by session so consumers (e.g. fork runner) can retrieve
  // per-session deps without relying on global mutable state.
  storeAgentToolDeps(session, agentToolDeps);

  return session;
}
