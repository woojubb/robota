/**
 * PermissionEnforcer — handles tool permission checking, hook execution,
 * and tool output truncation.
 *
 * Extracted from Session to separate permission/hook concerns from
 * conversation management.
 */

import { evaluatePermission, runHooks } from '@robota-sdk/agent-core';
import type {
  IToolWithEventService,
  IToolResult,
  TToolParameters,
  IToolExecutionContext,
  TPermissionMode,
  TToolArgs,
  THooksConfig,
  IHookInput,
} from '@robota-sdk/agent-core';
import type { ISessionLogger, TSessionLogData } from './session-logger.js';

/** Maximum chars for any single tool output. Matches Claude Code's 30K limit. */
const MAX_TOOL_OUTPUT_CHARS = 30_000;

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
 * Permission handler result:
 * - true: allow this invocation
 * - false: deny this invocation
 * - 'allow-session': allow this invocation and auto-approve this tool for the rest of the session
 */
export type TPermissionResult = boolean | 'allow-session';

/**
 * Custom permission handler — called when a tool needs user approval.
 * Returns true to allow, false to deny, or 'allow-session' to remember for the session.
 */
export type TPermissionHandler = (
  toolName: string,
  toolArgs: TToolArgs,
) => Promise<TPermissionResult>;

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

export interface IPermissionEnforcerOptions {
  sessionId: string;
  cwd: string;
  getPermissionMode: () => TPermissionMode;
  config: {
    permissions: { allow: string[]; deny: string[] };
    hooks?: Record<string, unknown>;
  };
  terminal: ITerminalOutput;
  permissionHandler?: TPermissionHandler;
  promptForApprovalFn?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  sessionLogger?: ISessionLogger;
  onToolExecution?: (event: { type: 'start' | 'end'; toolName: string; toolArgs?: TToolArgs; success?: boolean }) => void;
}

export class PermissionEnforcer {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly getPermissionMode: () => TPermissionMode;
  private readonly config: IPermissionEnforcerOptions['config'];
  private readonly terminal: ITerminalOutput;
  private readonly permissionHandler?: TPermissionHandler;
  private readonly promptForApprovalFn?: IPermissionEnforcerOptions['promptForApprovalFn'];
  private readonly sessionLogger?: ISessionLogger;
  private readonly onToolExecution?: IPermissionEnforcerOptions['onToolExecution'];
  private readonly sessionAllowedTools = new Set<string>();

  constructor(options: IPermissionEnforcerOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.getPermissionMode = options.getPermissionMode;
    this.config = options.config;
    this.terminal = options.terminal;
    this.permissionHandler = options.permissionHandler;
    this.promptForApprovalFn = options.promptForApprovalFn;
    this.sessionLogger = options.sessionLogger;
    this.onToolExecution = options.onToolExecution;
  }

  /** Wrap all tools with permission checking */
  wrapTools(tools: IToolWithEventService[]): IToolWithEventService[] {
    return tools.map((tool) => this.wrapToolWithPermission(tool));
  }

  /** Get tools that have been session-approved (via "Allow always" choice). */
  getSessionAllowedTools(): string[] {
    return [...this.sessionAllowedTools];
  }

  /** Clear all session-scoped allow rules. */
  clearSessionAllowedTools(): void {
    this.sessionAllowedTools.clear();
  }

  /**
   * Wrap a tool with permission checking.
   * The wrapper intercepts execute() and runs permission evaluation before delegating.
   * If denied, returns a tool result indicating the action was blocked.
   */
  private wrapToolWithPermission(tool: IToolWithEventService): IToolWithEventService {
    const enforcer = this;
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
        enforcer.log('tool_call', {
          tool: toolName,
          args: parameters as Record<string, string | number | boolean | object>,
        });

        const hookInput = enforcer.buildHookInput(toolName, parameters);

        const preResult = await enforcer.runPreToolHook(hookInput);
        if (preResult) {
          enforcer.log('tool_blocked', { tool: toolName, reason: 'hook' });
          return preResult;
        }

        const allowed = await enforcer.checkPermission(toolName, parameters as TToolArgs);
        if (!allowed) {
          enforcer.log('tool_denied', { tool: toolName, reason: 'permission' });
          return PERMISSION_DENIED_RESULT;
        }

        enforcer.onToolExecution?.({ type: 'start', toolName, toolArgs: parameters as TToolArgs });

        const result = await originalExecute(parameters, context as IToolExecutionContext);

        // Truncate oversized tool output (Claude Code uses 30K char limit)
        const truncatedResult = enforcer.truncateToolResult(result);

        enforcer.onToolExecution?.({ type: 'end', toolName, toolArgs: parameters as TToolArgs, success: truncatedResult.success });

        const dataSize =
          typeof truncatedResult.data === 'string'
            ? truncatedResult.data.length
            : JSON.stringify(truncatedResult.data).length;
        enforcer.log('tool_result', {
          tool: toolName,
          success: truncatedResult.success,
          dataChars: dataSize,
          truncated: truncatedResult !== result,
        });
        enforcer.firePostToolHook(hookInput, truncatedResult);
        return truncatedResult;
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

  /**
   * Truncate tool result data if it exceeds MAX_TOOL_OUTPUT_CHARS.
   * Uses middle-truncation: keeps first and last portions, removes middle.
   */
  private truncateToolResult(result: IToolResult): IToolResult {
    if (typeof result.data !== 'string') return result;
    if (result.data.length <= MAX_TOOL_OUTPUT_CHARS) return result;

    const halfLimit = Math.floor(MAX_TOOL_OUTPUT_CHARS / 2);
    const head = result.data.substring(0, halfLimit);
    const tail = result.data.substring(result.data.length - halfLimit);
    const originalSize = result.data.length;
    const truncatedData = `${head}\n\n[... output truncated: ${originalSize.toLocaleString()} chars total, showing first and last ${halfLimit.toLocaleString()} chars ...]\n\n${tail}`;

    return { ...result, data: truncatedData };
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
    const decision = evaluatePermission(toolName, toolArgs, this.getPermissionMode(), {
      allow: this.config.permissions.allow,
      deny: this.config.permissions.deny,
    });

    if (decision === 'auto') return true;
    if (decision === 'deny') return false;

    // Check session-scoped allow list before prompting
    if (this.sessionAllowedTools.has(toolName)) return true;

    // 'approve' — prompt the user via custom handler, injected approval fn, or deny
    if (this.permissionHandler) {
      const result = await this.permissionHandler(toolName, toolArgs);
      if (result === 'allow-session') {
        this.sessionAllowedTools.add(toolName);
        return true;
      }
      return result;
    }
    if (this.promptForApprovalFn) {
      return this.promptForApprovalFn(this.terminal, toolName, toolArgs);
    }
    // No approval mechanism available — deny by default
    return false;
  }

  /** Delegate session event to the injected logger. */
  private log(event: string, data: TSessionLogData): void {
    this.sessionLogger?.log(this.sessionId, event, data);
  }
}
