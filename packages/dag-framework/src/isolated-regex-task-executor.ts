import type {
  ITaskExecutionInput,
  ITaskExecutorPort,
  TTaskExecutionResult,
} from '@robota-sdk/dag-core';
import { IsolatedRegexOperation } from './isolated-regex-operation.js';

/** Leaves lifecycle, trusted capabilities and persistence in the parent. */
export class IsolatedRegexTaskExecutor implements ITaskExecutorPort {
  private readonly active = new Map<string, {
    operation: IsolatedRegexOperation;
    completion: Promise<void>;
  }>();
  public constructor(private readonly delegate: ITaskExecutorPort) {}
  private key(input: ITaskExecutionInput): string {
    return JSON.stringify([input.dagRunId, input.taskRunId, input.attempt]);
  }
  public async execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
    const key = this.key(input);
    const operation = new IsolatedRegexOperation(input.taskRunId, input.nodeId);
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => { complete = resolve; });
    this.active.set(key, { operation, completion });
    try {
      return await this.delegate.execute({ ...input, regexReplaceOperation: operation });
    } finally {
      try {
        await operation.stopAndWait();
      } finally {
        this.active.delete(key);
        complete();
      }
    }
  }
  public async stopAndWait(input: ITaskExecutionInput): Promise<void> {
    const attempt = this.active.get(this.key(input));
    if (!attempt) return;
    // Stop isolated work first so the delegated lifecycle can unwind. Completion
    // also joins provider cleanup and composite child runtimes owned by that call.
    await attempt.operation.stopAndWait();
    await attempt.completion;
  }
}
