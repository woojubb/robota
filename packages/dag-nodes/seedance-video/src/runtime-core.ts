import {
  buildTaskExecutionError,
  buildValidationError,
  type IDagError,
  type IPortBinaryValue,
  type TResult,
} from '@robota-sdk/dag-core';
import { BytedanceProvider } from '@robota-sdk/agent-provider/bytedance';
import type {
  IProviderMediaError,
  IVideoGenerationProvider,
  IVideoJobSnapshot,
} from '@robota-sdk/agent-core';
import { normalizeVideoOutput } from './video-output-normalizer.js';

/** Request payload for generating a video from a text prompt. */
export interface ISeedanceVideoRequest {
  prompt: string;
  model: string;
  durationSeconds?: number;
  aspectRatio?: string;
  pollIntervalMs: number;
  maxWaitMs: number;
}

/** Configuration options for the seedance-video runtime. */
export interface ISeedanceVideoRuntimeOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  allowedModels?: string[];
  /** Injectable delay (defaults to a setTimeout-based sleep) — overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

function parseCsv(value: string | undefined): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveModel(
  selectedModel: string,
  defaultModel: string,
  allowedModels: string[],
): TResult<string, IDagError> {
  const model = selectedModel.trim().length > 0 ? selectedModel.trim() : defaultModel;
  if (allowedModels.length > 0 && !allowedModels.includes(model)) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_SEEDANCE_VIDEO_MODEL_NOT_ALLOWED',
        'Selected seedance-video model is not allowed in DAG runtime',
        { model },
      ),
    };
  }
  return { ok: true, value: model };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runtime that delegates video generation to the ByteDance/Seedance provider.
 *
 * Video generation is asynchronous: `createVideo` submits a job, then `getVideoJob`
 * is polled until the job reaches a terminal status or the max-wait timeout elapses.
 */
export class SeedanceVideoRuntime {
  private readonly explicitApiKey?: string;
  private readonly explicitBaseUrl?: string;
  private readonly explicitDefaultModel?: string;
  private readonly explicitAllowedModels?: string[];
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor(options?: ISeedanceVideoRuntimeOptions) {
    this.explicitApiKey = options?.apiKey;
    this.explicitBaseUrl = options?.baseUrl;
    this.explicitDefaultModel = options?.defaultModel;
    this.explicitAllowedModels = options?.allowedModels;
    this.sleep = options?.sleep ?? defaultSleep;
  }

  private resolveDefaultModel(): TResult<string, IDagError> {
    const defaultModelValue =
      this.explicitDefaultModel ?? process.env.DAG_SEEDANCE_VIDEO_DEFAULT_MODEL;
    if (typeof defaultModelValue !== 'string' || defaultModelValue.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_SEEDANCE_VIDEO_MODEL_REQUIRED',
          'DAG_SEEDANCE_VIDEO_DEFAULT_MODEL must be configured or model must be specified in node config',
        ),
      };
    }
    return { ok: true, value: defaultModelValue.trim() };
  }

  private resolveAllowedModels(): string[] {
    return this.explicitAllowedModels ?? parseCsv(process.env.DAG_SEEDANCE_VIDEO_ALLOWED_MODELS);
  }

  private resolveProvider(): IVideoGenerationProvider | undefined {
    const apiKey = this.explicitApiKey ?? process.env.SEEDANCE_API_KEY;
    const baseUrl = this.explicitBaseUrl ?? process.env.SEEDANCE_BASE_URL;
    if (
      typeof apiKey === 'string' &&
      apiKey.trim().length > 0 &&
      typeof baseUrl === 'string' &&
      baseUrl.trim().length > 0
    ) {
      return new BytedanceProvider({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim() });
    }
    return undefined;
  }

  private mapProviderError(
    code:
      | 'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_CREATE_FAILED'
      | 'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_POLL_FAILED',
    error: IProviderMediaError,
    model: string,
  ): TResult<never, IDagError> {
    return {
      ok: false,
      error: buildTaskExecutionError(code, error.message, false, { code: error.code, model }),
    };
  }

  private async tryCancel(provider: IVideoGenerationProvider, jobId: string): Promise<void> {
    try {
      await provider.cancelVideoJob(jobId);
    } catch {
      // allow-fallback: cancel is best-effort on timeout
    }
  }

  public async generateVideo(
    request: ISeedanceVideoRequest,
  ): Promise<TResult<IPortBinaryValue, IDagError>> {
    const defaultModelResult = this.resolveDefaultModel();
    if (!defaultModelResult.ok) return defaultModelResult;
    const allowedModels = this.resolveAllowedModels();
    const provider = this.resolveProvider();
    if (!provider) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED',
          'SEEDANCE_API_KEY and SEEDANCE_BASE_URL must both be configured for seedance-video node runtime',
        ),
      };
    }
    const modelResult = resolveModel(request.model, defaultModelResult.value, allowedModels);
    if (!modelResult.ok) return modelResult;

    const created = await provider.createVideo({
      prompt: request.prompt,
      model: modelResult.value,
      ...(request.durationSeconds !== undefined
        ? { durationSeconds: request.durationSeconds }
        : {}),
      ...(request.aspectRatio !== undefined ? { aspectRatio: request.aspectRatio } : {}),
    });
    if (!created.ok) {
      return this.mapProviderError(
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_CREATE_FAILED',
        created.error,
        modelResult.value,
      );
    }

    return this.pollJob(provider, created.value.jobId, modelResult.value, request);
  }

  /**
   * Maps a terminal job snapshot to a result. Returns `undefined` for non-terminal
   * (`queued`/`running`) states so the caller keeps polling.
   */
  private mapTerminalSnapshot(
    job: IVideoJobSnapshot,
    model: string,
  ): TResult<IPortBinaryValue, IDagError> | undefined {
    if (job.status === 'succeeded') {
      if (!job.output) {
        return {
          ok: false,
          error: buildTaskExecutionError(
            'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_MISSING',
            'Seedance video job succeeded but returned no output',
            false,
            { jobId: job.jobId, model },
          ),
        };
      }
      return normalizeVideoOutput(job.output);
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_JOB_FAILED',
          `Seedance video job ${job.status}: ${job.error?.message ?? 'no error detail'}`,
          false,
          { jobId: job.jobId, status: job.status, providerCode: job.error?.code ?? 'unknown' },
        ),
      };
    }
    return undefined;
  }

  private async pollJob(
    provider: IVideoGenerationProvider,
    jobId: string,
    model: string,
    request: ISeedanceVideoRequest,
  ): Promise<TResult<IPortBinaryValue, IDagError>> {
    const startMs = Date.now();
    for (;;) {
      const snapshot = await provider.getVideoJob(jobId);
      if (!snapshot.ok) {
        return this.mapProviderError(
          'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_POLL_FAILED',
          snapshot.error,
          model,
        );
      }
      const terminal = this.mapTerminalSnapshot(snapshot.value, model);
      if (terminal) return terminal;
      if (Date.now() - startMs >= request.maxWaitMs) {
        await this.tryCancel(provider, jobId);
        return {
          ok: false,
          error: buildTaskExecutionError(
            'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_TIMEOUT',
            `Seedance video job did not complete within ${request.maxWaitMs}ms`,
            true,
            { jobId, maxWaitMs: request.maxWaitMs },
          ),
        };
      }
      await this.sleep(request.pollIntervalMs);
    }
  }
}
