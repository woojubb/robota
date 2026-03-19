/**
 * Session — wraps a Robota agent instance with project context, permission state,
 * and optional session persistence.
 *
 * Design notes:
 * - Accepts an optional `provider` parameter so tests can inject a mock AI provider
 *   without needing a real ANTHROPIC_API_KEY.
 * - AnthropicProvider is instantiated lazily from config when no provider is given.
 * - Permission checking via permission-gate runs before each tool execution through
 *   a middleware-style beforeToolCall hook registered on the Robota instance.
 */

import { Robota } from '@robota-sdk/agent-core';
import type { IAgentConfig } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type {
  IToolWithEventService,
  IToolResult,
  TToolParameters,
  IToolExecutionContext,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { evaluatePermission, runHooks, TRUST_TO_MODE } from '@robota-sdk/agent-core';
import type { TPermissionMode, TToolArgs, THooksConfig, IHookInput } from '@robota-sdk/agent-core';
import type { IContextWindowState } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import {
  bashTool,
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
} from '@robota-sdk/agent-tools';
import type { SessionStore, ISessionRecord } from './session-store.js';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

/** Returned when the user denies a permission prompt. success:true prevents ToolExecutionError. */
const PERMISSION_DENIED_RESULT: IToolResult = {
  success: true,
  data: JSON.stringify({
    success: false,
    output: '',
    error: 'Permission denied. The user did not approve this action.',
  }),
  metadata: {},
};

/** Known model context window sizes (tokens) */
const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
};
const DEFAULT_CONTEXT_SIZE = 200_000;

/** Auto-compact when context usage reaches this fraction */
const AUTO_COMPACT_THRESHOLD = 0.835;

/** Percentage conversion factor */
const PERCENT = 100;

/**
 * Spinner handle returned by ITerminalOutput.spinner()
 */
export interface ISpinner {
  stop(): void;
  update(message: string): void;
}

/**
 * Terminal output abstraction — injected into all components that need I/O
 */
export interface ITerminalOutput {
  write(text: string): void;
  writeLine(text: string): void;
  writeMarkdown(md: string): void;
  writeError(text: string): void;
  prompt(question: string): Promise<string>;
  /** Arrow-key selector. Returns the index of the chosen option. */
  select(options: string[], initialIndex?: number): Promise<number>;
  spinner(message: string): ISpinner;
}

/**
 * Custom permission handler — called when a tool needs user approval.
 * Returns true to allow, false to deny.
 */
export type TPermissionHandler = (toolName: string, toolArgs: TToolArgs) => Promise<boolean>;

/**
 * Resolved CLI configuration — passed into Session.
 * This interface mirrors IResolvedConfig from agent-sdk config but is
 * defined here to avoid circular dependency back to agent-sdk.
 */
export interface IResolvedConfig {
  defaultTrustLevel: 'safe' | 'moderate' | 'full';
  provider: {
    name: string;
    model: string;
    apiKey: string | undefined;
  };
  permissions: {
    allow: string[];
    deny: string[];
  };
  env: Record<string, string>;
  hooks?: Record<string, unknown>;
}

/**
 * Loaded context from AGENTS.md / CLAUDE.md files.
 */
export interface ILoadedContext {
  agentsMd: string;
  claudeMd: string;
}

/**
 * Project metadata for system prompt.
 */
export interface IProjectInfo {
  type: string;
  language: string;
}

/**
 * System prompt builder parameters.
 */
export interface ISystemPromptParams {
  agentsMd: string;
  claudeMd: string;
  toolDescriptions: string[];
  trustLevel: 'safe' | 'moderate' | 'full';
  projectInfo: IProjectInfo;
}

/**
 * Build a system prompt from context and project info.
 * This is a simplified version — the full builder lives in agent-sdk.
 */
function buildSystemPrompt(params: ISystemPromptParams): string {
  const parts: string[] = [];

  if (params.agentsMd) {
    parts.push(params.agentsMd);
  }
  if (params.claudeMd) {
    parts.push(params.claudeMd);
  }

  parts.push(`\nAvailable tools: ${params.toolDescriptions.join(', ')}`);
  parts.push(`Trust level: ${params.trustLevel}`);
  parts.push(`Project type: ${params.projectInfo.type}, Language: ${params.projectInfo.language}`);

  return parts.join('\n\n');
}

/** Options for constructing a Session */
export interface ISessionOptions {
  /** Resolved CLI configuration (model, API key, permissions) */
  config: IResolvedConfig;
  /** Loaded AGENTS.md / CLAUDE.md context */
  context: ILoadedContext;
  /** Terminal I/O for permission prompts */
  terminal: ITerminalOutput;
  /** Initial permission mode (defaults to config.defaultTrustLevel → mode mapping) */
  permissionMode?: TPermissionMode;
  /** Maximum number of agentic turns per run() call. Undefined = unlimited. */
  maxTurns?: number;
  /** Optional session store for persistence */
  sessionStore?: SessionStore;
  /** Project metadata for system prompt */
  projectInfo?: IProjectInfo;
  /** Inject a pre-constructed AI provider (used by tests to avoid real API calls) */
  provider?: IAIProvider;
  /** Custom permission handler (overrides terminal-based prompts, used by Ink UI) */
  permissionHandler?: TPermissionHandler;
  /** Callback for text deltas — enables streaming text to the UI in real-time */
  onTextDelta?: (delta: string) => void;
  /** Custom system prompt builder function (injected from agent-sdk) */
  systemPromptBuilder?: (params: ISystemPromptParams) => string;
  /** Custom prompt-for-approval function (injected from CLI) */
  promptForApproval?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  /** Additional tools to register (e.g. agent-tool from agent-sdk) */
  additionalTools?: IToolWithEventService[];
  /** Callback when context is compacted */
  onCompact?: (summary: string) => void;
  /** Instructions to include in the compaction prompt (e.g. from CLAUDE.md) */
  compactInstructions?: string;
}

/** Names of the 6 built-in CLI tools */
const TOOL_DESCRIPTIONS = [
  'Bash — execute shell commands',
  'Read — read file contents with line numbers',
  'Write — write content to a file',
  'Edit — replace a string in a file',
  'Glob — find files matching a pattern',
  'Grep — search file contents with regex',
];

/**
 * Session class.
 *
 * Maintains conversation history by keeping the same Robota agent across multiple
 * run() calls.  The session ID is stable for the lifetime of the object.
 */
export class Session {
  private readonly robota: Robota;
  private readonly sessionId: string;
  private permissionMode: TPermissionMode;
  private readonly terminal: ITerminalOutput;
  private readonly config: IResolvedConfig;
  private readonly sessionStore?: SessionStore;
  private readonly permissionHandler?: TPermissionHandler;
  private readonly promptForApprovalFn?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  private readonly cwd: string;
  private readonly onCompactCallback?: (summary: string) => void;
  private readonly compactInstructions?: string;
  private readonly aiProvider: IAIProvider;
  private messageCount = 0;
  private contextUsedTokens = 0;
  private contextMaxTokens = DEFAULT_CONTEXT_SIZE;

  constructor(options: ISessionOptions) {
    const {
      config,
      context,
      terminal,
      permissionMode,
      sessionStore,
      projectInfo,
      provider,
      permissionHandler,
    } = options;

    this.config = config;
    this.terminal = terminal;
    this.sessionStore = sessionStore;
    this.permissionHandler = permissionHandler;
    this.promptForApprovalFn = options.promptForApproval;
    this.onCompactCallback = options.onCompact;
    this.compactInstructions = options.compactInstructions;
    this.cwd = process.cwd();
    this.sessionId = `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;

    // Resolve permission mode from explicit arg or config default
    this.permissionMode = permissionMode ?? TRUST_TO_MODE[config.defaultTrustLevel] ?? 'default';

    // Build system message
    const buildPrompt = options.systemPromptBuilder ?? buildSystemPrompt;
    const systemMessage = buildPrompt({
      agentsMd: context.agentsMd,
      claudeMd: context.claudeMd,
      toolDescriptions: TOOL_DESCRIPTIONS,
      trustLevel: config.defaultTrustLevel,
      projectInfo: projectInfo ?? { type: 'unknown', language: 'unknown' },
    });

    // Resolve AI provider and wire up streaming if callback provided
    const aiProvider = provider ?? this.createAnthropicProvider();
    this.aiProvider = aiProvider;
    this.contextMaxTokens = MODEL_CONTEXT_SIZES[config.provider.model] ?? DEFAULT_CONTEXT_SIZE;
    if (options.onTextDelta && 'onTextDelta' in aiProvider) {
      (aiProvider as { onTextDelta?: (delta: string) => void }).onTextDelta = options.onTextDelta;
    }

    const tools = this.initializeTools(options.additionalTools);

    const agentConfig: IAgentConfig = {
      name: 'robota-cli',
      aiProviders: [aiProvider],
      defaultModel: {
        provider: aiProvider.name,
        model: config.provider.model,
        systemMessage,
      },
      tools,
      logging: { enabled: false },
    };

    this.robota = new Robota(agentConfig);
  }

  /**
   * Create an AnthropicProvider lazily from config.
   * Throws a descriptive error if no API key is available.
   */
  private createAnthropicProvider(): IAIProvider {
    const apiKey = this.config.provider.apiKey ?? process.env['ANTHROPIC_API_KEY'];

    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. ' +
          'Set the environment variable or configure provider.apiKey in ~/.robota/settings.json',
      );
    }

    return new AnthropicProvider({ apiKey });
  }

  /** Initialize tools and wrap all tools with permission checking */
  private initializeTools(additionalTools?: IToolWithEventService[]): IToolWithEventService[] {
    const rawTools: IToolWithEventService[] = [
      bashTool as IToolWithEventService,
      readTool as IToolWithEventService,
      writeTool as IToolWithEventService,
      editTool as IToolWithEventService,
      globTool as IToolWithEventService,
      grepTool as IToolWithEventService,
      ...(additionalTools ?? []),
    ];
    return rawTools.map((tool) => this.wrapToolWithPermission(tool));
  }

  /**
   * Send a message to the agent and return the response.
   *
   * Permission checks are applied per tool invocation inside the Robota run loop
   * via the beforeToolCall hook registered in the constructor.
   */
  async run(message: string): Promise<string> {
    const response = await this.robota.run(message);
    this.messageCount += 1;

    // Update token usage from the latest assistant message metadata
    this.updateTokenUsageFromHistory();

    // Auto-compact if threshold exceeded
    if (this.getContextState().usedPercentage >= AUTO_COMPACT_THRESHOLD * PERCENT) {
      await this.compact();
    }

    if (this.sessionStore) {
      this.persistSession();
    }

    return response;
  }

  /** Persist the current session to the store */
  private persistSession(): void {
    if (!this.sessionStore) return;

    const history = this.robota.getHistory();
    const now = new Date().toISOString();

    const existing = this.sessionStore.load(this.sessionId);

    const record: ISessionRecord = {
      id: this.sessionId,
      cwd: this.cwd,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages: history,
    };

    this.sessionStore.save(record);
  }

  /** Return the active permission mode */
  getPermissionMode(): TPermissionMode {
    return this.permissionMode;
  }

  /**
   * Change the active permission mode.
   * Future tool calls will be evaluated against the new mode.
   */
  setPermissionMode(mode: TPermissionMode): void {
    this.permissionMode = mode;
  }

  /** Return the stable session identifier */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Return the number of run() calls completed */
  getMessageCount(): number {
    return this.messageCount;
  }

  /**
   * Wrap a tool with permission checking.
   * The wrapper intercepts execute() and runs permission evaluation before delegating.
   * If denied, returns a tool result indicating the action was blocked.
   */
  private wrapToolWithPermission(tool: IToolWithEventService): IToolWithEventService {
    const session = this;
    const originalExecute = tool.execute.bind(tool);

    const wrappedTool = Object.create(tool) as IToolWithEventService;
    wrappedTool.execute = async (
      parameters: TToolParameters,
      context?: IToolExecutionContext,
    ): Promise<IToolResult> => {
      // Must NEVER throw — if this throws, the execution round records the
      // assistant tool_use in history but never adds a tool_result, which
      // corrupts the conversation and causes a 400 error on the next API call.
      try {
        const toolName = tool.getName();
        const hookInput = session.buildHookInput(toolName, parameters);

        const preResult = await session.runPreToolHook(hookInput);
        if (preResult) return preResult;

        const allowed = await session.checkPermission(toolName, parameters as TToolArgs);
        if (!allowed) return PERMISSION_DENIED_RESULT;

        const result = await originalExecute(parameters, context as IToolExecutionContext);
        session.firePostToolHook(hookInput, result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: true,
          data: JSON.stringify({ success: false, output: '', error: message }),
          metadata: {},
        };
      }
    };

    return wrappedTool;
  }

  /** Build a hook input object for tool execution hooks */
  private buildHookInput(toolName: string, parameters: TToolParameters): IHookInput {
    return {
      session_id: this.sessionId,
      cwd: this.cwd,
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: parameters as Record<string, string | number | boolean | object>,
    };
  }

  /** Run PreToolUse hooks; returns a denial IToolResult if blocked, or null to proceed */
  private async runPreToolHook(hookInput: IHookInput): Promise<IToolResult | null> {
    const hookResult = await runHooks(
      this.config.hooks as THooksConfig | undefined,
      'PreToolUse',
      hookInput,
    );
    if (hookResult.blocked) {
      return {
        success: true,
        data: JSON.stringify({
          success: false,
          output: '',
          error: `Blocked by hook: ${hookResult.reason}`,
        }),
        metadata: {},
      };
    }
    return null;
  }

  /** Fire PostToolUse hooks (fire and forget) */
  private firePostToolHook(hookInput: IHookInput, result: IToolResult): void {
    const postHookInput: IHookInput = {
      ...hookInput,
      hook_event_name: 'PostToolUse',
      tool_output: typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
    };
    runHooks(this.config.hooks as THooksConfig | undefined, 'PostToolUse', postHookInput).catch(
      () => {},
    );
  }

  /** Evaluate permission for a tool call using the current mode and config */
  async checkPermission(toolName: string, toolArgs: TToolArgs): Promise<boolean> {
    const decision = evaluatePermission(toolName, toolArgs, this.permissionMode, {
      allow: this.config.permissions.allow,
      deny: this.config.permissions.deny,
    });

    if (decision === 'auto') return true;
    if (decision === 'deny') return false;

    // 'approve' — prompt the user via custom handler, injected approval fn, or deny
    if (this.permissionHandler) {
      return this.permissionHandler(toolName, toolArgs);
    }
    if (this.promptForApprovalFn) {
      return this.promptForApprovalFn(this.terminal, toolName, toolArgs);
    }
    // No approval mechanism available — deny by default
    return false;
  }

  /** Get current context window state */
  getContextState(): IContextWindowState {
    const usedPercentage = Math.min(
      PERCENT,
      (this.contextUsedTokens / this.contextMaxTokens) * PERCENT,
    );
    return {
      maxTokens: this.contextMaxTokens,
      usedTokens: this.contextUsedTokens,
      usedPercentage: Math.round(usedPercentage * PERCENT) / PERCENT,
      remainingPercentage: Math.round((PERCENT - usedPercentage) * PERCENT) / PERCENT,
    };
  }

  /**
   * Run compaction — summarize the conversation to free context space.
   * @param instructions - Optional focus instructions for the summary
   */
  async compact(instructions?: string): Promise<void> {
    const history = this.robota.getHistory();
    if (history.length === 0) return;

    const trigger: 'auto' | 'manual' = instructions !== undefined ? 'manual' : 'auto';

    // Fire PreCompact hook
    const preHookInput: IHookInput = {
      session_id: this.sessionId,
      cwd: this.cwd,
      hook_event_name: 'PreCompact',
      trigger,
    };
    await runHooks(this.config.hooks as THooksConfig | undefined, 'PreCompact', preHookInput);

    // Build compaction prompt
    const compactPrompt = this.buildCompactionPrompt(history, instructions);

    // Call provider to generate summary
    const summaryMessage = await this.aiProvider.chat(
      [{ role: 'user', content: compactPrompt, timestamp: new Date() }],
      { model: this.config.provider.model },
    );
    const summary =
      typeof summaryMessage.content === 'string' ? summaryMessage.content : '(compaction failed)';

    // Replace history with summary message
    this.robota.clearHistory();
    // Re-inject summary as a system-level context message
    await this.robota.run(
      `[Context Summary]\n${summary}\n\nPlease continue from where we left off.`,
    );

    // Reset token tracking based on the new shorter history
    this.updateTokenUsageFromHistory();

    // Fire PostCompact hook
    const postHookInput: IHookInput = {
      session_id: this.sessionId,
      cwd: this.cwd,
      hook_event_name: 'PostCompact',
      trigger,
      compact_summary: summary,
    };
    runHooks(this.config.hooks as THooksConfig | undefined, 'PostCompact', postHookInput).catch(
      () => {},
    );

    // Notify via callback
    if (this.onCompactCallback) {
      this.onCompactCallback(summary);
    }
  }

  /** Build the compaction prompt from conversation history */
  private buildCompactionPrompt(history: TUniversalMessage[], instructions?: string): string {
    const instructionBlock = instructions ?? this.compactInstructions ?? '';
    const instructionSection = instructionBlock ? `\nAdditional focus:\n${instructionBlock}\n` : '';

    const formattedHistory = history
      .map((msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return `${msg.role}: ${content}`;
      })
      .join('\n');

    return [
      'Summarize the following conversation concisely, preserving:',
      "- User's original requests and goals",
      '- Key decisions and conclusions',
      '- Important code changes and file paths',
      '- Current task status and next steps',
      instructionSection,
      "Drop verbose tool outputs, debugging steps, and exploratory work that didn't lead to results.",
      '',
      'Conversation:',
      formattedHistory,
    ].join('\n');
  }

  /** Extract token usage from the latest assistant messages in history */
  private updateTokenUsageFromHistory(): void {
    const history = this.robota.getHistory();
    let totalInputTokens = 0;

    for (const msg of history) {
      if (msg.metadata) {
        const input = msg.metadata['inputTokens'];
        const output = msg.metadata['outputTokens'];
        if (typeof input === 'number') totalInputTokens += input;
        if (typeof output === 'number') totalInputTokens += output;
      }
    }

    this.contextUsedTokens = totalInputTokens;
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.robota.clearHistory();
    this.contextUsedTokens = 0;
  }

  /** Get conversation history */
  getHistory(): TUniversalMessage[] {
    return this.robota.getHistory();
  }
}
