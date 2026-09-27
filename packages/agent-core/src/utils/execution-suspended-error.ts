import type { IToolWaitRequest } from '../interfaces/tool-continuation';

/** A persisted wait is control flow, never a failed tool result or semantic completion. */
export class ExecutionSuspendedError extends Error {
  readonly code = 'EXECUTION_SUSPENDED';
  readonly requests: readonly IToolWaitRequest[];
  constructor(requests: readonly IToolWaitRequest[]) {
    super('Execution is waiting for correlated tool responses');
    this.name = 'ExecutionSuspendedError';
    this.requests = structuredClone(requests);
  }
}
