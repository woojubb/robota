import type { IAgentSession, ISessionPermissions, ISessionViolation } from '@robota-sdk/dag-core';
import { randomUUID } from 'node:crypto';

/**
 * Enforces ISessionPermissions on MCP tool calls.
 * Used by the local MCP server to bound agent capabilities.
 */
export class SessionPermissionGate {
  private readonly session: IAgentSession;

  public constructor(permissions: ISessionPermissions, sessionId?: string) {
    this.session = {
      sessionId: sessionId ?? randomUUID(),
      createdAt: Date.now(),
      permissions,
      totalCostUsd: 0,
    };
  }

  public get sessionId(): string {
    return this.session.sessionId;
  }

  /** Record a cost charge. Returns violation if it would exceed the budget. */
  public chargeCost(costUsd: number): ISessionViolation | undefined {
    const { maxCostUsd } = this.session.permissions;
    if (typeof maxCostUsd === 'number') {
      const projected = this.session.totalCostUsd + costUsd;
      if (projected > maxCostUsd) {
        return {
          code: 'SESSION_BUDGET_EXCEEDED',
          message: `Cost limit $${maxCostUsd.toFixed(4)} would be exceeded. Current: $${this.session.totalCostUsd.toFixed(4)}, Required: $${costUsd.toFixed(4)}`,
          fix: {
            action: 'request_new_session',
            suggestion: `Request a new session with higher maxCostUsd from your administrator`,
          },
        };
      }
    }
    this.session.totalCostUsd += costUsd;
    return undefined;
  }

  /** Check if session has expired. */
  public checkExpiry(): ISessionViolation | undefined {
    if (typeof this.session.expiresAt === 'number' && Date.now() > this.session.expiresAt) {
      return {
        code: 'SESSION_EXPIRED',
        message: 'This agent session has expired',
        fix: {
          action: 'request_new_session',
          suggestion: 'Request a new session token from your administrator',
        },
      };
    }
    return undefined;
  }

  /**
   * Check if all node types in a proposed pipeline are permitted.
   * Pass the list of nodeTypes that will be used.
   */
  public checkNodeTypes(
    nodeTypes: string[],
    availableNodeTypes?: string[],
  ): ISessionViolation | undefined {
    const { allowedNodeTypes, deniedNodeTypes } = this.session.permissions;

    for (const nodeType of nodeTypes) {
      if (deniedNodeTypes && deniedNodeTypes.includes(nodeType)) {
        return {
          code: 'NODE_TYPE_DENIED',
          message: `Node type "${nodeType}" is explicitly denied for this session`,
          fix: {
            action: 'replace_node_type',
            suggestion: `Remove "${nodeType}" from your pipeline`,
            options: allowedNodeTypes
              ? [...allowedNodeTypes]
              : availableNodeTypes?.filter((t) => !deniedNodeTypes.includes(t)),
          },
        };
      }

      if (allowedNodeTypes && !allowedNodeTypes.includes(nodeType)) {
        return {
          code: 'NODE_TYPE_NOT_PERMITTED',
          message: `Node type "${nodeType}" is not in your session's allowedNodeTypes`,
          fix: {
            action: 'replace_node_type',
            suggestion: `Use one of the permitted node types`,
            options: [...allowedNodeTypes],
          },
        };
      }
    }
    return undefined;
  }

  /** Check if instant node creation is permitted. */
  public checkInstantNodeCreation(): ISessionViolation | undefined {
    if (this.session.permissions.canCreateInstantNodes === false) {
      return {
        code: 'INSTANT_NODE_NOT_PERMITTED',
        message: 'This session does not permit creating instant nodes',
        fix: {
          action: 'request_elevated_session',
          suggestion:
            'Request a new session with canCreateInstantNodes=true from your administrator',
        },
      };
    }
    return undefined;
  }

  /** Returns a summary of current session state for logging/debugging. */
  public summary(): { sessionId: string; totalCostUsd: number; permissions: ISessionPermissions } {
    return {
      sessionId: this.session.sessionId,
      totalCostUsd: this.session.totalCostUsd,
      permissions: this.session.permissions,
    };
  }
}

/**
 * Parses session permissions from the DAG_SESSION_PERMISSIONS environment variable.
 * Format: JSON string of ISessionPermissions.
 * Returns undefined if the variable is not set (no restrictions).
 */
export function parseSessionPermissionsFromEnv(): ISessionPermissions | undefined {
  const raw = process.env['DAG_SESSION_PERMISSIONS'];
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  try {
    // allow-fallback: invalid JSON env var is ignored with a warning; open access is the safe default
    return JSON.parse(raw) as ISessionPermissions; // allow-any: JSON.parse returns unknown but ISessionPermissions is the expected shape
  } catch {
    // allow-fallback: invalid JSON env var is ignored with a warning; open access is the safe default
    process.stderr.write(
      `[dag-mcp] Warning: DAG_SESSION_PERMISSIONS is not valid JSON, ignoring.\n`,
    );
    return undefined;
  }
}
