/**
 * Session factory — assembles a fully-configured Session from config, context,
 * tools, and provider.
 *
 * This is the main entry point for creating sessions. It wires together
 * the provider, tools, system prompt, and configuration that Session now
 * expects as pre-constructed dependencies.
 */

import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
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
import { createProvider } from './create-provider.js';

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
}

/**
 * Create a fully-configured Session instance.
 *
 * Assembles provider, tools, and system prompt, then passes them
 * to Session as pre-constructed dependencies.
 */
export function createSession(options: ICreateSessionOptions): Session {
  const provider = options.provider ?? createProvider(options.config);

  const defaultTools = createDefaultTools();
  const tools = [...defaultTools, ...(options.additionalTools ?? [])];

  const buildPrompt = options.systemPromptBuilder ?? buildSystemPrompt;
  const systemMessage = buildPrompt({
    agentsMd: options.context.agentsMd,
    claudeMd: options.context.claudeMd,
    toolDescriptions: options.toolDescriptions ?? DEFAULT_TOOL_DESCRIPTIONS,
    trustLevel: options.config.defaultTrustLevel,
    projectInfo: options.projectInfo ?? { type: 'unknown', language: 'unknown' },
    cwd: process.cwd(),
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

  return new Session({
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
    permissionHandler: options.permissionHandler,
    onTextDelta: options.onTextDelta,
    promptForApproval: options.promptForApproval,
    onCompact: options.onCompact,
    compactInstructions: options.compactInstructions ?? options.context.compactInstructions,
    sessionLogger: options.sessionLogger,
  });
}
