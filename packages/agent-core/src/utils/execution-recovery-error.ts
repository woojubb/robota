export type TExecutionRecoveryErrorCode =
  'EXECUTION_RECOVERY_INVALID' | 'EXECUTION_RECOVERY_REQUIRED' | 'EXECUTION_RECOVERY_CONFLICT';

/** Recovery refuses unproven effects or history instead of guessing whether to replay them. */
export class ExecutionRecoveryError extends Error {
  constructor(
    readonly code: TExecutionRecoveryErrorCode,
    message: string,
    readonly actionIds: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ExecutionRecoveryError';
  }
}
