import type {
  ITaskExecutionInput,
  ITaskExecutorPort,
  TTaskExecutionResult,
} from '@robota-sdk/dag-core';
import { IsolatedRegexOperation } from './isolated-regex-operation.js';

/** Leaves lifecycle, trusted capabilities and persistence in the parent. */
export class IsolatedRegexTaskExecutor implements ITaskExecutorPort {
  private readonly active = new Map<string, IsolatedRegexOperation>();
  public constructor(private readonly delegate: ITaskExecutorPort) {}
  private key(input: ITaskExecutionInput): string {
    return JSON.stringify([input.dagRunId, input.taskRunId, input.attempt]);
  }
  public async execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
    const key = this.key(input);
    const operation = new IsolatedRegexOperation(input.taskRunId, input.nodeId);
    this.active.set(key, operation);
    try {
      return await this.delegate.execute({ ...input, regexReplaceOperation: operation });
    } finally {
      try {
        await operation.stopAndWait();
      } finally {
        this.active.delete(key);
      }
    }
  }
  public async stopAndWait(input: ITaskExecutionInput): Promise<void> {
    await this.active.get(this.key(input))?.stopAndWait();
  }
}
