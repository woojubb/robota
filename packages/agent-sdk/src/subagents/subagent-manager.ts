import type {
  ISubagentJobHandle,
  ISubagentJobResult,
  ISubagentJobState,
  ISubagentManager,
  ISubagentManagerOptions,
  ISubagentSpawnRequest,
} from './types.js';

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_DEPTH = 1;
const PROMPT_PREVIEW_LENGTH = 120;

interface ITrackedSubagentJob {
  state: ISubagentJobState;
  request: ISubagentSpawnRequest;
  completion: Promise<ISubagentJobResult>;
  resolve: (result: ISubagentJobResult) => void;
  reject: (error: Error) => void;
  handle?: ISubagentJobHandle;
}

function createDeferred(): {
  promise: Promise<ISubagentJobResult>;
  resolve: (result: ISubagentJobResult) => void;
  reject: (error: Error) => void;
} {
  let resolveFn: (result: ISubagentJobResult) => void = () => {};
  let rejectFn: (error: Error) => void = () => {};
  const promise = new Promise<ISubagentJobResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  promise.catch(() => {});
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function toErrorMessage(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

export class SubagentManager implements ISubagentManager {
  private readonly runner: ISubagentManagerOptions['runner'];
  private readonly maxConcurrent: number;
  private readonly maxDepth: number;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly jobs = new Map<string, ITrackedSubagentJob>();
  private readonly queue: string[] = [];
  private activeCount = 0;
  private sequence = 0;

  constructor(options: ISubagentManagerOptions) {
    this.runner = options.runner;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory =
      options.idFactory ??
      (() => {
        this.sequence += 1;
        return `agent_${this.sequence}`;
      });
  }

  async spawn(request: ISubagentSpawnRequest): Promise<ISubagentJobState> {
    if (request.depth > this.maxDepth) {
      throw new Error(
        `Subagent depth limit exceeded: depth=${request.depth} maxDepth=${this.maxDepth}`,
      );
    }

    const id = this.idFactory();
    const deferred = createDeferred();
    const state: ISubagentJobState = {
      id,
      type: request.type,
      label: request.label,
      parentSessionId: request.parentSessionId,
      status: 'queued',
      mode: request.mode,
      depth: request.depth,
      cwd: request.cwd,
      promptPreview: request.prompt.slice(0, PROMPT_PREVIEW_LENGTH),
      updatedAt: this.now(),
    };

    this.jobs.set(id, {
      state,
      request,
      completion: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
    });
    this.queue.push(id);
    this.drainQueue();
    return this.cloneState(state);
  }

  wait(jobId: string): Promise<ISubagentJobResult> {
    return this.requireJob(jobId).completion;
  }

  list(): ISubagentJobState[] {
    return [...this.jobs.values()].map((job) => this.cloneState(job.state));
  }

  get(jobId: string): ISubagentJobState | undefined {
    const job = this.jobs.get(jobId);
    return job ? this.cloneState(job.state) : undefined;
  }

  async cancel(jobId: string, reason?: string): Promise<void> {
    const job = this.requireJob(jobId);
    if (this.isTerminal(job.state.status)) return;

    if (job.state.status === 'queued') {
      this.removeFromQueue(jobId);
      this.markCancelled(job, reason);
      return;
    }

    await job.handle?.cancel(reason);
    this.markCancelled(job, reason);
  }

  async close(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    if (!this.isTerminal(job.state.status)) {
      throw new Error(`Cannot close active subagent job: ${jobId}`);
    }
    this.jobs.delete(jobId);
  }

  async send(jobId: string, prompt: string): Promise<void> {
    const job = this.requireJob(jobId);
    if (!job.handle?.send) {
      throw new Error(`Subagent runner does not support follow-up messages: ${jobId}`);
    }
    await job.handle.send(prompt);
  }

  private drainQueue(): void {
    while (this.activeCount < this.maxConcurrent) {
      const jobId = this.queue.shift();
      if (!jobId) return;
      const job = this.jobs.get(jobId);
      if (!job || job.state.status !== 'queued') continue;
      this.startJob(job);
    }
  }

  private startJob(job: ITrackedSubagentJob): void {
    job.state.status = 'running';
    job.state.startedAt = this.now();
    job.state.updatedAt = job.state.startedAt;
    this.activeCount += 1;

    try {
      const handle = this.runner.start({ jobId: job.state.id, request: job.request });
      job.handle = handle;
      if (handle.pid) job.state.pid = handle.pid;
      handle.result.then(
        (result) => this.completeJob(job, result),
        (error) =>
          this.failJob(job, toErrorMessage(error instanceof Error ? error : String(error))),
      );
    } catch (error) {
      this.failJob(job, toErrorMessage(error instanceof Error ? error : String(error)));
    }
  }

  private completeJob(job: ITrackedSubagentJob, result: ISubagentJobResult): void {
    if (this.isTerminal(job.state.status)) return;
    job.state.status = 'completed';
    job.state.result = result.output;
    job.state.completedAt = this.now();
    job.state.updatedAt = job.state.completedAt;
    this.activeCount -= 1;
    job.resolve(result);
    this.drainQueue();
  }

  private failJob(job: ITrackedSubagentJob, message: string): void {
    if (this.isTerminal(job.state.status)) return;
    job.state.status = 'failed';
    job.state.error = message;
    job.state.completedAt = this.now();
    job.state.updatedAt = job.state.completedAt;
    this.activeCount -= 1;
    job.reject(new Error(message));
    this.drainQueue();
  }

  private markCancelled(job: ITrackedSubagentJob, reason?: string): void {
    if (this.isTerminal(job.state.status)) return;
    job.state.status = 'cancelled';
    job.state.error = reason;
    job.state.completedAt = this.now();
    job.state.updatedAt = job.state.completedAt;
    if (job.handle) this.activeCount -= 1;
    job.reject(new Error(reason ?? 'Subagent job cancelled'));
    this.drainQueue();
  }

  private removeFromQueue(jobId: string): void {
    const index = this.queue.indexOf(jobId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private requireJob(jobId: string): ITrackedSubagentJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown subagent job: ${jobId}`);
    return job;
  }

  private isTerminal(status: ISubagentJobState['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }

  private cloneState(state: ISubagentJobState): ISubagentJobState {
    return { ...state };
  }
}
