/** Permissions granted to a single agent session. */
export interface ISessionPermissions {
  /** Allowed node types. undefined = all types permitted. */
  readonly allowedNodeTypes?: readonly string[];
  /** Explicitly denied node types (takes priority over allowedNodeTypes). */
  readonly deniedNodeTypes?: readonly string[];
  /** Maximum total cost in USD for this session. undefined = no limit. */
  readonly maxCostUsd?: number;
  /** Maximum single-run execution time in ms. undefined = no limit. */
  readonly maxExecutionTimeMs?: number;
  /** Whether this session can create instant (prompt-backed) nodes. Default: true. */
  readonly canCreateInstantNodes?: boolean;
}

/** A bounded session granting an AI agent limited access to DAG MCP tools. */
export interface IAgentSession {
  readonly sessionId: string;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly permissions: ISessionPermissions;
  /** Accumulated cost in USD across all runs in this session. */
  totalCostUsd: number;
}

/** Structured violation when a session permission check fails. */
export interface ISessionViolation {
  readonly code:
    | 'SESSION_EXPIRED'
    | 'NODE_TYPE_NOT_PERMITTED'
    | 'NODE_TYPE_DENIED'
    | 'SESSION_BUDGET_EXCEEDED'
    | 'INSTANT_NODE_NOT_PERMITTED';
  readonly message: string;
  readonly fix?: {
    readonly action: string;
    readonly suggestion: string;
    readonly options?: readonly string[];
  };
}
