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

import { Robota } from '../core/robota.js';
import { buildSystemPrompt } from '../cli-context/system-prompt-builder.js';
import { evaluatePermission } from '../cli-permissions/permission-gate.js';
import { TRUST_TO_MODE } from '../cli-permissions/types.js';
import { runHooks } from '../cli-hooks/hook-runner.js';
import type { IAgentConfig } from '../interfaces/agent.js';
import type { IAIProvider } from '../interfaces/provider.js';
import type { IToolResult, TToolParameters, IToolExecutionContext } from '../interfaces/tool.js';
import type { IToolWithEventService } from '../abstracts/abstract-tool.js';
import type { TUniversalMessage } from '../interfaces/messages.js';
import type { IResolvedConfig } from '../cli-config/config-types.js';
import type { ILoadedContext } from '../cli-context/context-loader.js';
import type { IProjectInfo } from '../cli-context/project-detector.js';
import type { TPermissionMode } from '../cli-permissions/types.js';
import type { TToolArgs } from '../cli-permissions/permission-gate.js';
import type { THooksConfig, IHookInput } from '../cli-hooks/types.js';
import type { SessionStore, ISessionRecord } from './session-store.js';

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
  /** Initial permission mode (defaults to config.defaultTrustLevel -> mode mapping) */
  permissionMode?: TPermissionMode;
  /** Maximum number of agentic turns per run() call. Undefined = unlimited. */
  maxTurns?: number;
  /** Optional session store for persistence */
  sessionStore?: SessionStore;
  /** Project metadata for system prompt */
  projectInfo?: IProjectInfo;
  /** Inject a pre-constructed AI provider (used by tests to avoid real API calls) */
  provider?: IAIProvider;
  /** Factory to create the default AI provider. Avoids circular dependency on provider packages. */
  providerFactory?: (apiKey: string) => IAIProvider;
  /** Custom permission handler (overrides terminal-based prompts, used by Ink UI) */
  permissionHandler?: TPermissionHandler;
  /** Callback for text deltas — enables streaming text to the UI in real-time */
  onTextDelta?: (delta: string) => void;
  /** Default permission prompt function (injected by agent-cli for terminal-based prompts) */
  promptForApproval?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  /**
   * Factory that creates CLI tools. Injected by the CLI entry point to avoid
   * circular dependency (cli-tools -> agent-tools -> agent-core).
   * Returns the raw tool instances that will be wrapped with permission checking.
   */
  toolsFactory?: (
    config: IResolvedConfig,
    context: ILoadedContext,
    projectInfo?: IProjectInfo,
  ) => IToolWithEventService[];
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
 *
 * The Robota agent is initialized lazily on first run() to allow deferred
 * provider creation based on config.
 */
export class Session {
  private robota: Robota | null = null;
  private readonly options: ISessionOptions;
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
  private messageCount = 0;

  constructor(options: ISessionOptions) {
    this.options = options;
    this.config = options.config;
    this.terminal = options.terminal;
    this.sessionStore = options.sessionStore;
    this.permissionHandler = options.permissionHandler;
    this.promptForApprovalFn = options.promptForApproval;
    this.cwd = process.cwd();
    this.sessionId = `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;

    // Resolve permission mode from explicit arg or config default
    this.permissionMode =
      options.permissionMode ?? TRUST_TO_MODE[options.config.defaultTrustLevel] ?? 'default';
  }

  /** Build the Robota agent with a resolved provider */
  private buildRobota(aiProvider: IAIProvider): Robota {
    const { config, context, projectInfo } = this.options;

    if (this.options.onTextDelta && 'onTextDelta' in aiProvider) {
      (aiProvider as { onTextDelta?: (delta: string) => void }).onTextDelta =
        this.options.onTextDelta;
    }

    const systemMessage = buildSystemPrompt({
      agentsMd: context.agentsMd,
      claudeMd: context.claudeMd,
      toolDescriptions: TOOL_DESCRIPTIONS,
      trustLevel: config.defaultTrustLevel,
      projectInfo: projectInfo ?? { type: 'unknown', language: 'unknown' },
    });

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

    return new Robota(agentConfig);
  }

  /**
   * Ensure the Robota agent is initialized.
   * If no provider was given at construction, lazily create an AnthropicProvider.
   */
  private ensureInitialized(): Robota {
    if (this.robota) return this.robota;

    const provider = this.options.provider ?? this.createDefaultProvider();
    this.robota = this.buildRobota(provider);
    return this.robota;
  }

  /**
   * Create a default provider from config using the injected factory.
   * Throws a descriptive error if no API key or factory is available.
   */
  private createDefaultProvider(): IAIProvider {
    const apiKey = this.config.provider.apiKey ?? process.env['ANTHROPIC_API_KEY'];

    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. ' +
          'Set the environment variable or configure provider.apiKey in ~/.robota/settings.json',
      );
    }

    if (!this.options.providerFactory) {
      throw new Error(
        'No AI provider or providerFactory supplied. ' +
          'Pass a provider instance or providerFactory in SessionOptions.',
      );
    }

    return this.options.providerFactory(apiKey);
  }

  /**
   * Initialize agent tool dependencies and wrap all tools with permission checking.
   * Uses the injected toolsFactory to avoid circular dependency.
   */
  private initializeTools(
    config: IResolvedConfig,
    context: ILoadedContext,
    projectInfo?: IProjectInfo,
  ): IToolWithEventService[] {
    if (!this.options.toolsFactory) {
      return [];
    }

    const rawTools = this.options.toolsFactory(config, context, projectInfo);
    return rawTools.map((tool) => this.wrapToolWithPermission(tool));
  }

  /**
   * Send a message to the agent and return the response.
   *
   * Permission checks are applied per tool invocation inside the Robota run loop
   * via the beforeToolCall hook registered in the constructor.
   */
  async run(message: string): Promise<string> {
    const robota = this.ensureInitialized();
    const response = await robota.run(message);
    this.messageCount += 1;

    if (this.sessionStore) {
      this.persistSession();
    }

    return response;
  }

  /** Persist the current session to the store */
  private persistSession(): void {
    if (!this.sessionStore || !this.robota) return;

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

    // 'approve' — prompt the user via custom handler or injected prompt function
    if (this.permissionHandler) {
      return this.permissionHandler(toolName, toolArgs);
    }
    if (this.promptForApprovalFn) {
      return this.promptForApprovalFn(this.terminal, toolName, toolArgs);
    }
    // No prompt function available — default to deny for safety
    return false;
  }

  /** Clear conversation history */
  clearHistory(): void {
    if (this.robota) {
      this.robota.clearHistory();
    }
  }

  /** Get conversation history */
  getHistory(): TUniversalMessage[] {
    if (this.robota) {
      return this.robota.getHistory();
    }
    return [];
  }
}
