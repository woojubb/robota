import type {
  IAgentRecoverableHint,
  IDagError,
  IErrorFix,
  TErrorCategory,
} from '../types/error.js';

/** Create a structured {@link IDagError} with all required fields. */
export function buildDagError(
  category: TErrorCategory,
  code: string,
  message: string,
  retryable: boolean,
  context?: Record<string, string | number | boolean>,
  fix?: IErrorFix,
  agentHint?: IAgentRecoverableHint,
): IDagError {
  return {
    code,
    category,
    message,
    retryable,
    context,
    fix,
    agentHint,
  };
}

/** Shorthand for creating a non-retryable validation error. */
export function buildValidationError(
  code: string,
  message: string,
  context?: Record<string, string | number | boolean>,
  fix?: IErrorFix,
  agentHint?: IAgentRecoverableHint,
): IDagError {
  return buildDagError('validation', code, message, false, context, fix, agentHint);
}

/** Shorthand for creating a retryable dispatch error. */
export function buildDispatchError(
  code: string,
  message: string,
  context?: Record<string, string | number | boolean>,
  fix?: IErrorFix,
  agentHint?: IAgentRecoverableHint,
): IDagError {
  return buildDagError('dispatch', code, message, true, context, fix, agentHint);
}

/** Shorthand for creating a non-retryable lease error. */
export function buildLeaseError(
  code: string,
  message: string,
  context?: Record<string, string | number | boolean>,
  fix?: IErrorFix,
  agentHint?: IAgentRecoverableHint,
): IDagError {
  return buildDagError('lease', code, message, false, context, fix, agentHint);
}

/** Shorthand for creating a task execution error with configurable retryability. */
export function buildTaskExecutionError(
  code: string,
  message: string,
  retryable: boolean,
  context?: Record<string, string | number | boolean>,
  fix?: IErrorFix,
  agentHint?: IAgentRecoverableHint,
): IDagError {
  return buildDagError('task_execution', code, message, retryable, context, fix, agentHint);
}
