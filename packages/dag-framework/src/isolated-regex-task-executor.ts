import type {
  ITaskExecutionInput,
  ITaskExecutorPort,
  TTaskExecutionResult,
} from '@robota-sdk/dag-core';
import { resolveDagExecutionByteLimits } from '@robota-sdk/dag-core';
import { IsolatedRegexOperation } from './isolated-regex-operation.js';

/** Leaves lifecycle, trusted capabilities and persistence in the parent. */
export class IsolatedRegexTaskExecutor implements ITaskExecutorPort {
  private readonly active = new Map<
    string,
    {
      operation: IsolatedRegexOperation;
      completion: Promise<void>;
    }
  >();
  /**
   * @param delegate Wrapped executor; receives `regexReplaceOperation` on every call.
   * @param joinDelegateCompletion When true (the default, preserving `LocalDagRuntimeProvider`'s
   *   existing contract), `stopAndWait` also joins the delegate's own `execute()` settling —
   *   correct there because that composition owns and expects to wait on the full node lifecycle.
   *   A composition that hosts arbitrary node types (e.g. `createDagFramework`'s default executor)
   *   must pass `false`: this wrapper exists only to isolate the regex operation, and joining
   *   the delegate's completion would make every node's timeout/cancel wait for that node's own
   *   (possibly abort-ignoring) work to finish, contradicting dag-worker's contract that ordinary
   *   cooperative cleanup is not awaited — only isolation shutdown is.
   */
  public constructor(
    private readonly delegate: ITaskExecutorPort,
    private readonly joinDelegateCompletion: boolean = true,
  ) {}
  private key(input: ITaskExecutionInput): string {
    return JSON.stringify([input.dagRunId, input.taskRunId, input.attempt]);
  }
  public async execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
    const key = this.key(input);
    const operation = new IsolatedRegexOperation(
      input.taskRunId,
      input.nodeId,
      undefined,
      resolveDagExecutionByteLimits(input.byteLimits).maxTextReplaceOutputBytes,
    );
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
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
    // Stop isolated work first so the delegated lifecycle can unwind. When
    // `joinDelegateCompletion` is set, completion also joins provider cleanup and composite
    // child runtimes owned by that call — otherwise this only joins the isolated regex
    // operation's own shutdown, leaving the delegate's (possibly abort-ignoring) work unjoined.
    await attempt.operation.stopAndWait();
    if (this.joinDelegateCompletion) await attempt.completion;
  }
}
