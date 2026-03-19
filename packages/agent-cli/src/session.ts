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
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import type { ITerminalOutput, TPermissionMode } from './types.js';
import type { IResolvedConfig } from './config/config-types.js';
import type { ILoadedContext } from './context/context-loader.js';
import type { IProjectInfo } from './context/project-detector.js';
import { buildSystemPrompt } from './context/system-prompt-builder.js';
import { TRUST_TO_MODE } from './types.js';
import { evaluatePermission } from './permissions/permission-gate.js';
import type { TToolArgs } from './permissions/permission-gate.js';
import { promptForApproval } from './permissions/permission-prompt.js';
import { bashTool } from './tools/bash-tool.js';
import { readTool } from './tools/read-tool.js';
import { writeTool } from './tools/write-tool.js';
import { editTool } from './tools/edit-tool.js';
import { globTool } from './tools/glob-tool.js';
import { grepTool } from './tools/grep-tool.js';
import { agentTool, setAgentToolDeps } from './tools/agent-tool.js';
import type { SessionStore, ISessionRecord } from './session-store.js';
import { runHooks } from './hooks/hook-runner.js';
import type { THooksConfig, IHookInput } from './hooks/types.js';

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

/**
 * Custom permission handler — called when a tool needs user approval.
 * Returns true to allow, false to deny.
 */
export type TPermissionHandler = (toolName: string, toolArgs: TToolArgs) => Promise<boolean>;

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
}

/** Names of the 6 built-in CLI tools */
const TOOL_DESCRIPTIONS = [
  'Bash — execute shell commands',
  'Read — read file contents with line numbers',
  'Write — write content to a file',
  'Edit — replace a string in a file',
  'Glob — find files matching a pattern',
  'Grep — search file contents with regex',
  'Agent — spawn a sub-agent with isolated context for complex tasks',
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
  private readonly cwd: string;
  private messageCount = 0;

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
    this.cwd = process.cwd();
    this.sessionId = `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;

    // Resolve permission mode from explicit arg or config default
    this.permissionMode = permissionMode ?? TRUST_TO_MODE[config.defaultTrustLevel] ?? 'default';

    // Build system message
    const systemMessage = buildSystemPrompt({
      agentsMd: context.agentsMd,
      claudeMd: context.claudeMd,
      toolDescriptions: TOOL_DESCRIPTIONS,
      trustLevel: config.defaultTrustLevel,
      projectInfo: projectInfo ?? { type: 'unknown', language: 'unknown' },
    });

    // Resolve AI provider and wire up streaming if callback provided
    const aiProvider = provider ?? this.createAnthropicProvider();
    if (options.onTextDelta && 'onTextDelta' in aiProvider) {
      (aiProvider as { onTextDelta?: (delta: string) => void }).onTextDelta = options.onTextDelta;
    }

    const tools = this.initializeTools(config, context, projectInfo);

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
   *
   * NOTE: We import AnthropicProvider at the top of the file to keep construction
   * synchronous. The import is conditional (via the optional provider parameter) so
   * tests can inject a mock and skip the real provider entirely.
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

  /** Initialize agent tool dependencies and wrap all tools with permission checking */
  private initializeTools(
    config: IResolvedConfig,
    context: ILoadedContext,
    projectInfo?: IProjectInfo,
  ): IToolWithEventService[] {
    setAgentToolDeps({
      config,
      context,
      projectInfo: projectInfo ?? { type: 'unknown', language: 'unknown' },
    });

    const rawTools = [bashTool, readTool, writeTool, editTool, globTool, grepTool, agentTool];
    return rawTools.map((tool) => this.wrapToolWithPermission(tool as IToolWithEventService));
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

    // 'approve' — prompt the user via custom handler or terminal
    if (this.permissionHandler) {
      return this.permissionHandler(toolName, toolArgs);
    }
    return promptForApproval(this.terminal, toolName, toolArgs);
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.robota.clearHistory();
  }

  /** Get conversation history */
  getHistory(): TUniversalMessage[] {
    return this.robota.getHistory();
  }
}
