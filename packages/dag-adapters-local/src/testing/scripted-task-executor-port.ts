import type {
  ITaskExecutionInput,
  ITaskExecutorPort,
  TTaskExecutionResult,
} from '@robota-sdk/dag-core';

/** A caller-supplied handler that produces a task result for one execution input. */
export type TTaskExecutorHandler = (input: ITaskExecutionInput) => Promise<TTaskExecutionResult>;

/** Default handler: echo the input straight back as a successful output. */
async function echoExecutor(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
  return {
    ok: true,
    output: input.input,
  };
}

/**
 * An {@link ITaskExecutorPort} that runs a caller-scripted handler (defaulting to an echo). Tests inject the
 * handler to drive whatever execution behavior a scenario needs. (HARNESS-033: relocated from the package main
 * entry + renamed from `MockTaskExecutorPort` — it genuinely runs an injected script, it is not a mock; the
 * no-fake-in-src rule keeps `Mock*` names to test code, and this now lives under `./testing`.)
 */
export class ScriptedTaskExecutorPort implements ITaskExecutorPort {
  private readonly executor: TTaskExecutorHandler;

  public constructor(executor: TTaskExecutorHandler = echoExecutor) {
    this.executor = executor;
  }

  public async execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
    return this.executor(input);
  }
}
