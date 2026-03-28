/**
 * PermissionEnforcer — handles tool permission checking, hook execution,
 * and tool output truncation.
 *
 * Extracted from Session to separate permission/hook concerns from
 * conversation management.
 */

import { evaluatePermission } from '@robota-sdk/agent-core';
import type {
  IToolWithEventService,
  IToolResult,
  TToolParameters,
  IToolExecutionContext,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type { ISessionLogger, TSessionLogData } from './session-logger.js';
import type {
  IPermissionEnforcerOptions,
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './permission-types.js';
import { PERMISSION_DENIED_RESULT } from './permission-types.js';
import {
  truncateToolResult,
  buildHookInput,
  runPreToolHook,
  firePostToolHook,
} from './tool-hook-helpers.js';

export type { TPermissionHandler, TPermissionResult, ITerminalOutput, ISpinner };
export type { IPermissionEnforcerOptions };

export class PermissionEnforcer {
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly getPermissionMode: IPermissionEnforcerOptions['getPermissionMode'];
  private readonly config: IPermissionEnforcerOptions['config'];
  private readonly terminal: ITerminalOutput;
  private readonly permissionHandler?: TPermissionHandler;
  private readonly promptForApprovalFn?: IPermissionEnforcerOptions['promptForApprovalFn'];
  private readonly sessionLogger?: ISessionLogger;
  private readonly onToolExecution?: IPermissionEnforcerOptions['onToolExecution'];
  private readonly hookTypeExecutors?: IPermissionEnforcerOptions['hookTypeExecutors'];
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
    this.hookTypeExecutors = options.hookTypeExecutors;
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

        const hookInput = buildHookInput(enforcer.sessionId, enforcer.cwd, toolName, parameters);

        const preResult = await runPreToolHook(
          enforcer.config.hooks,
          hookInput,
          enforcer.hookTypeExecutors,
        );
        if (preResult) {
          enforcer.log('tool_blocked', { tool: toolName, reason: 'hook' });
          return preResult;
        }

        const allowed = await enforcer.checkPermission(toolName, parameters as TToolArgs);
        if (!allowed) {
          enforcer.log('tool_denied', { tool: toolName, reason: 'permission' });
          enforcer.onToolExecution?.({
            type: 'end',
            toolName,
            toolArgs: parameters as TToolArgs,
            success: false,
            denied: true,
          });
          return PERMISSION_DENIED_RESULT;
        }

        enforcer.onToolExecution?.({ type: 'start', toolName, toolArgs: parameters as TToolArgs });

        const result = await originalExecute(parameters, context as IToolExecutionContext);

        // Truncate oversized tool output (Claude Code uses 30K char limit)
        const truncatedResult = truncateToolResult(result);

        enforcer.onToolExecution?.({
          type: 'end',
          toolName,
          toolArgs: parameters as TToolArgs,
          success: truncatedResult.success,
          toolResultData:
            typeof truncatedResult.data === 'string'
              ? truncatedResult.data
              : JSON.stringify(truncatedResult.data),
        });

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
        firePostToolHook(
          enforcer.config.hooks,
          hookInput,
          truncatedResult,
          enforcer.hookTypeExecutors,
        );
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
