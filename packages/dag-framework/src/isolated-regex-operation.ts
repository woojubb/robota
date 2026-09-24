import { Worker } from 'node:worker_threads';
import { RegexProcessWorker } from './regex-process-worker.js';
import {
  buildTaskCancellationError,
  buildTaskExecutionError,
  buildValidationError,
  type IDagError,
  type IRegexReplaceOperation,
  type IRegexReplaceRequest,
  type TResult,
} from '@robota-sdk/dag-core';

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
// Trusted, fixed bootstrap: no file lookup, user module import or user-supplied executable source.
// No runtime sidecar or package-resolution dependency is required by the Node artifact.
const BOOTSTRAP = `
const { parentPort } = require('node:worker_threads');
parentPort.once('message', (request) => {
  parentPort.postMessage({ type: 'entered' });
  try {
    const value = request.text.replace(new RegExp(request.search, request.flags), request.replacement);
    parentPort.postMessage(Buffer.byteLength(value, 'utf8') > ${MAX_MESSAGE_BYTES}
      ? { type: 'oversized' } : { type: 'result', value });
  } catch {
    parentPort.postMessage({ type: 'invalid-regex' });
  }
  parentPort.close();
});
parentPort.postMessage({ type: 'ready' });
`;

type TOperationResult = TResult<string, IDagError>;
interface IRegexWorker {
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'error', listener: () => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  postMessage(request: IRegexReplaceRequest): void;
  terminate(): Promise<number>;
}
type TWorkerFactory = (source: string) => IRegexWorker;
const createWorker: TWorkerFactory = (source) =>
  process.versions.bun
    ? new RegexProcessWorker()
    : new Worker(source, { eval: true, execArgv: [] });

/** One operation per worker; the owning task retains the only termination handle. */
export class IsolatedRegexOperation implements IRegexReplaceOperation {
  private worker?: IRegexWorker;
  private exit?: Promise<void>;
  private stopping = false;
  private used = false;
  private termination?: Promise<void>;
  public constructor(
    private readonly taskRunId: string,
    private readonly nodeId: string,
    private readonly factory: TWorkerFactory = createWorker,
  ) {}

  public async execute(
    request: IRegexReplaceRequest,
    signal?: AbortSignal,
  ): Promise<TOperationResult> {
    if (this.used)
      return this.failure(
        'DAG_TASK_ISOLATION_ALREADY_USED',
        'Regex operation capability is single-use',
      );
    this.used = true;
    if (signal?.aborted) return { ok: false, error: buildTaskCancellationError(this.taskRunId) };
    if (
      Object.values(request).reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0) >
      MAX_MESSAGE_BYTES
    )
      return this.failure(
        'DAG_TASK_ISOLATION_MESSAGE_LIMIT',
        'Regex operation request exceeds its byte limit',
      );
    let worker: IRegexWorker;
    try {
      worker = this.factory(BOOTSTRAP);
    } catch {
      return this.failure(
        'DAG_TASK_ISOLATION_START_FAILED',
        'Could not start isolated regex execution',
      );
    }
    this.worker = worker;
    let exitResolve!: () => void;
    this.exit = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });
    // Bun may otherwise exit the host before termination's promise continuation runs.
    const keepalive = setInterval(() => {}, 1000);
    const abort = (): void => {
      void this.stopAndWait().catch(() => {});
    };
    const result = await new Promise<TOperationResult>((resolve) => {
      let received: TOperationResult | undefined;
      worker.on('message', (message: unknown) => {
        if (this.stopping || signal?.aborted) return;
        if (!message || typeof message !== 'object' || !('type' in message)) {
          received = this.failure('DAG_TASK_ISOLATION_PROTOCOL', 'Invalid isolated regex response');
          abort();
          return;
        }
        if (message.type === 'ready') {
          try {
            worker.postMessage(request);
          } catch {
            received = this.failure('DAG_TASK_ISOLATION_PROTOCOL', 'Could not send regex request');
            abort();
          }
        } else if (
          message.type === 'result' &&
          'value' in message &&
          typeof message.value === 'string'
        ) {
          received =
            Buffer.byteLength(message.value, 'utf8') <= MAX_MESSAGE_BYTES
              ? { ok: true, value: message.value }
              : this.failure(
                  'DAG_TASK_ISOLATION_MESSAGE_LIMIT',
                  'Regex operation output exceeds its byte limit',
                );
        } else if (message.type === 'invalid-regex')
          received = {
            ok: false,
            error: buildValidationError(
              'DAG_VALIDATION_TEXT_REPLACE_INVALID_REGEX',
              `Invalid regex: "${request.search}"`,
              { nodeId: this.nodeId },
            ),
          };
        else if (message.type === 'oversized')
          received = this.failure(
            'DAG_TASK_ISOLATION_MESSAGE_LIMIT',
            'Regex operation output exceeds its byte limit',
          );
        else if (message.type !== 'entered') {
          received = this.failure('DAG_TASK_ISOLATION_PROTOCOL', 'Invalid isolated regex response');
          abort();
        }
      });
      worker.on('error', () => {
        received = this.failure('DAG_TASK_ISOLATION_FAILED', 'Isolated regex execution failed');
        void this.stopAndWait().catch(() => {});
      });
      worker.once('exit', (code) => {
        clearInterval(keepalive);
        signal?.removeEventListener('abort', abort);
        this.worker = undefined;
        exitResolve();
        resolve(
          signal?.aborted
            ? { ok: false, error: buildTaskCancellationError(this.taskRunId) }
            : code === 0 && received
              ? received
              : received?.ok === false
                ? received
                : this.failure(
                    'DAG_TASK_ISOLATION_EXITED',
                    'Isolated regex worker exited without a result',
                  ),
        );
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    return result;
  }

  public stopAndWait(): Promise<void> {
    if (this.termination) return this.termination;
    const worker = this.worker;
    if (!worker) return Promise.resolve();
    this.stopping = true;
    this.termination = (async () => {
      await worker.terminate();
      await this.exit;
    })();
    return this.termination;
  }

  private failure(code: string, message: string): TOperationResult {
    return {
      ok: false,
      error: buildTaskExecutionError(code, message, false, { taskRunId: this.taskRunId }),
    };
  }
}
