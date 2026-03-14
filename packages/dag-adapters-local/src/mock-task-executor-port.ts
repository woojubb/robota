import type {
    ITaskExecutionInput,
    ITaskExecutorPort,
    TTaskExecutionResult
} from '@robota-sdk/dag-core';

export type TTaskExecutorHandler = (input: ITaskExecutionInput) => Promise<TTaskExecutionResult>;

async function defaultExecutor(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
    return {
        ok: true,
        output: input.input
    };
}

export class MockTaskExecutorPort implements ITaskExecutorPort {
    private readonly executor: TTaskExecutorHandler;

    public constructor(executor: TTaskExecutorHandler = defaultExecutor) {
        this.executor = executor;
    }

    public async execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
        return this.executor(input);
    }
}
