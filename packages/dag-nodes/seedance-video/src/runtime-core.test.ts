import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  IVideoJobAccepted,
  IVideoJobSnapshot,
  TProviderMediaResult,
} from '@robota-sdk/agent-core';
import { SeedanceVideoRuntime, type ISeedanceVideoRequest } from './runtime-core.js';
import { BytedanceProvider } from '@robota-sdk/agent-provider/bytedance';

// Shared job mocks so every constructed BytedanceProvider uses the same fns. The factory lives in
// vi.hoisted so the vi.mock() call stays a single line (keeps the allow-module-mock escape attached).
const { createVideo, getVideoJob, cancelVideoJob, bytedanceMockFactory } = vi.hoisted(() => {
  const createVideo = vi.fn();
  const getVideoJob = vi.fn();
  const cancelVideoJob = vi.fn();
  const bytedanceMockFactory = (): { BytedanceProvider: unknown } => ({
    BytedanceProvider: vi
      .fn()
      .mockImplementation(() => ({ createVideo, getVideoJob, cancelVideoJob })),
  });
  return { createVideo, getVideoJob, cancelVideoJob, bytedanceMockFactory };
});

// Full replacement avoids loading the ByteDance HTTP client; only the video job methods are exercised.
vi.mock('@robota-sdk/agent-provider/bytedance', bytedanceMockFactory); // allow-module-mock: BytedanceProvider hits the real ModelArk API

const MODEL = 'seedance-2.0';

function accepted(): TProviderMediaResult<IVideoJobAccepted> {
  return {
    ok: true,
    value: { jobId: 'job-1', status: 'queued', createdAt: '2026-07-05T00:00:00Z' },
  };
}

function snapshot(overrides: Partial<IVideoJobSnapshot>): TProviderMediaResult<IVideoJobSnapshot> {
  return {
    ok: true,
    value: { jobId: 'job-1', status: 'running', updatedAt: '2026-07-05T00:00:01Z', ...overrides },
  };
}

function makeRuntime(): SeedanceVideoRuntime {
  return new SeedanceVideoRuntime({
    apiKey: 'k',
    baseUrl: 'https://api.test',
    defaultModel: MODEL,
    sleep: async () => {},
  });
}

function req(overrides?: Partial<ISeedanceVideoRequest>): ISeedanceVideoRequest {
  return { prompt: 'a drone shot', model: '', pollIntervalMs: 1, maxWaitMs: 1000, ...overrides };
}

describe('SeedanceVideoRuntime', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    savedEnv = {
      SEEDANCE_API_KEY: process.env.SEEDANCE_API_KEY,
      SEEDANCE_BASE_URL: process.env.SEEDANCE_BASE_URL,
      DAG_SEEDANCE_VIDEO_DEFAULT_MODEL: process.env.DAG_SEEDANCE_VIDEO_DEFAULT_MODEL,
      DAG_SEEDANCE_VIDEO_ALLOWED_MODELS: process.env.DAG_SEEDANCE_VIDEO_ALLOWED_MODELS,
    };
    for (const key of Object.keys(savedEnv)) delete process.env[key];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns validation error when default model is missing', async () => {
    const runtime = new SeedanceVideoRuntime({ apiKey: 'k', baseUrl: 'https://api.test' });
    const result = await runtime.generateVideo(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_VIDEO_MODEL_REQUIRED');
  });

  it('returns validation error when credentials are missing', async () => {
    const runtime = new SeedanceVideoRuntime({ defaultModel: MODEL });
    const result = await runtime.generateVideo(req());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED');
    }
  });

  it('returns validation error when model is not allowed', async () => {
    const runtime = new SeedanceVideoRuntime({
      apiKey: 'k',
      baseUrl: 'https://api.test',
      defaultModel: MODEL,
      allowedModels: ['only-this'],
      sleep: async () => {},
    });
    const result = await runtime.generateVideo(req({ model: 'other-model' }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_VIDEO_MODEL_NOT_ALLOWED');
  });

  it('maps a createVideo failure to a task execution error', async () => {
    createVideo.mockResolvedValue({
      ok: false,
      error: { code: 'PROVIDER_AUTH_ERROR', message: 'bad key' },
    });
    const result = await makeRuntime().generateVideo(req());
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_CREATE_FAILED');
  });

  it('polls until succeeded and normalizes the video output', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValueOnce(snapshot({ status: 'running' })).mockResolvedValueOnce(
      snapshot({
        status: 'succeeded',
        output: { kind: 'uri', uri: 'https://cdn.test/v.mp4', mimeType: 'video/mp4', bytes: 1024 },
      }),
    );
    const result = await makeRuntime().generateVideo(req());
    expect(getVideoJob).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('video');
      expect(result.value.mimeType).toBe('video/mp4');
      expect(result.value.uri).toBe('https://cdn.test/v.mp4');
    }
  });

  it('defaults a missing mime type to video/mp4', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue(
      snapshot({ status: 'succeeded', output: { kind: 'uri', uri: 'https://cdn.test/v.mp4' } }),
    );
    const result = await makeRuntime().generateVideo(req());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mimeType).toBe('video/mp4');
  });

  it('maps a failed job to a task execution error', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue(
      snapshot({ status: 'failed', error: { code: 'PROVIDER_UPSTREAM_ERROR', message: 'boom' } }),
    );
    const result = await makeRuntime().generateVideo(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_JOB_FAILED');
  });

  it('maps a getVideoJob failure to a poll error', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue({
      ok: false,
      error: { code: 'PROVIDER_JOB_NOT_FOUND', message: 'gone' },
    });
    const result = await makeRuntime().generateVideo(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_POLL_FAILED');
  });

  it('errors when a succeeded job has no output', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue(snapshot({ status: 'succeeded' }));
    const result = await makeRuntime().generateVideo(req());
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_MISSING');
  });

  it('times out and best-effort cancels when the job never completes', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue(snapshot({ status: 'running' }));
    cancelVideoJob.mockResolvedValue(snapshot({ status: 'cancelled' }));
    const result = await makeRuntime().generateVideo(req({ maxWaitMs: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_TIMEOUT');
    expect(cancelVideoJob).toHaveBeenCalledWith('job-1');
  });

  it('does not send the seed field and forwards duration/aspectRatio', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue(
      snapshot({ status: 'succeeded', output: { kind: 'uri', uri: 'https://cdn.test/v.mp4' } }),
    );
    await makeRuntime().generateVideo(req({ durationSeconds: 5, aspectRatio: '16:9' }));
    expect(createVideo).toHaveBeenCalledWith({
      prompt: 'a drone shot',
      model: MODEL,
      durationSeconds: 5,
      aspectRatio: '16:9',
    });
  });
});
