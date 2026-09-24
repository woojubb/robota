import { buildTaskExecutionError } from '../utils/error-builders.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import type { IExecutionCommitResult } from './execution-commit.js';

export interface ITaskSnapshotBudgetLimits {
  readonly inputBytes: number;
  readonly outputBytes: number;
}
export const DEFAULT_TASK_SNAPSHOT_BUDGET_LIMITS: ITaskSnapshotBudgetLimits = Object.freeze({
  inputBytes: 16 * 1024 * 1024,
  outputBytes: 16 * 1024 * 1024,
});
export function resolveTaskSnapshotBudgetLimits(
  limits: ITaskSnapshotBudgetLimits = DEFAULT_TASK_SNAPSHOT_BUDGET_LIMITS,
): ITaskSnapshotBudgetLimits {
  if (
    !limits ||
    !Number.isSafeInteger(limits.inputBytes) ||
    limits.inputBytes < 0 ||
    !Number.isSafeInteger(limits.outputBytes) ||
    limits.outputBytes < 0
  ) {
    throw new RangeError('Task snapshot limits must be nonnegative safe integers');
  }
  return Object.freeze({ inputBytes: limits.inputBytes, outputBytes: limits.outputBytes });
}

/** Trusted live root capability. Never serialized into definitions, queues or snapshots. */
export interface ITaskSnapshotBudget {
  /** Close future admissions; already reserved writes retain their capacity. */
  close(): void;
  admit(
    direction: 'input' | 'output',
    snapshot: string,
    persist: () => Promise<IExecutionCommitResult>,
  ): Promise<TResult<IExecutionCommitResult, IDagError>>;
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/** Cumulative accepted snapshot writes, with pending writes reserving capacity synchronously. */
export class TaskSnapshotBudget implements ITaskSnapshotBudget {
  private readonly limits: ITaskSnapshotBudgetLimits;
  private readonly occupied = { input: 0, output: 0 };
  private poisoned = false;
  public constructor(limits?: ITaskSnapshotBudgetLimits) {
    this.limits = resolveTaskSnapshotBudgetLimits(limits);
  }
  public close(): void {
    this.poisoned = true;
  }
  public async admit(
    direction: 'input' | 'output',
    snapshot: string,
    persist: () => Promise<IExecutionCommitResult>,
  ): Promise<TResult<IExecutionCommitResult, IDagError>> {
    const bytes = utf8Bytes(snapshot);
    const limit = direction === 'input' ? this.limits.inputBytes : this.limits.outputBytes;
    if (this.poisoned || bytes > limit - this.occupied[direction]) {
      return {
        ok: false,
        error: buildTaskExecutionError(
          this.poisoned ? 'DAG_TASK_SNAPSHOT_BUDGET_CLOSED' : 'DAG_TASK_SNAPSHOT_BUDGET_EXCEEDED',
          this.poisoned
            ? 'Task snapshot budget is closed'
            : `Task ${direction} snapshot budget exceeded`,
          false,
        ),
      };
    }
    this.occupied[direction] += bytes;
    try {
      const result = await persist();
      // A rejected exact-attempt commit persisted no snapshot; accepted writes remain charged.
      if (!result.applied) this.occupied[direction] -= bytes;
      return { ok: true, value: result };
    } catch (error) {
      // A thrown write can have reached durable storage. Do not refund or admit any more writes.
      this.poisoned = true;
      throw error;
    }
  }
}
