/** Classification of DAG errors by their origin and nature. */
export type TErrorCategory =
  | 'validation'
  | 'state_transition'
  | 'lease'
  | 'dispatch'
  | 'task_execution';

/**
 * Corrective action an agent can take to resolve an error without human intervention.
 * Every IDagError exposed to agents should include a fix where a mechanical correction exists.
 */
export interface IErrorFix {
  /** Machine-readable action verb the agent should perform. */
  readonly action: string;
  /** Concrete replacement value or instruction. */
  readonly suggestion?: string;
  /** All valid alternatives the agent may choose from. */
  readonly options?: readonly string[];
}

/**
 * Structured hint for agent self-correction. Provides machine-readable signals
 * so an orchestrating agent can autonomously recover from a node failure without
 * human intervention.
 *
 * Designed for MCP-002: IAgentRecoverableError standardisation.
 */
export interface IAgentRecoverableHint {
  /** Machine-readable failure code. */
  readonly code:
    | 'MISSING_API_KEY'
    | 'RATE_LIMITED'
    | 'TIMEOUT'
    | 'INVALID_NODE_TYPE'
    | 'INVALID_MODEL'
    | 'CONTEXT_TOO_LONG'
    | string;
  /** Whether the same request may succeed if retried without changes. */
  readonly retryable: boolean;
  /** Milliseconds to wait before retrying (relevant for rate-limit scenarios). */
  readonly retryAfterMs?: number;
  /** Alternative model the agent may switch to. */
  readonly suggestedModel?: string;
  /** Machine-readable action verb the agent should perform. */
  readonly action?: 'SET_ENV_VAR' | 'SWITCH_MODEL' | 'REDUCE_INPUT' | 'RETRY' | string;
  /** Concrete instructions for performing the action. */
  readonly actionDetail?: string;
}

/** Structured error used across all DAG packages. */
export interface IDagError {
  code: string;
  category: TErrorCategory;
  message: string;
  retryable: boolean;
  context?: Record<string, string | number | boolean>;
  /** Agent-actionable correction hint. Present when a mechanical fix exists. */
  fix?: IErrorFix;
  /**
   * Structured self-correction hint for agent orchestrators (MCP-002).
   * Present when the error is recoverable by an agent without human input.
   */
  agentHint?: IAgentRecoverableHint;
}
