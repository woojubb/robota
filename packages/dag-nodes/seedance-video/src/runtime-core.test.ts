import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IMediaProviderConfig,
  IMediaProviderDefinition,
  IVideoGenerationProvider,
  IVideoJobAccepted,
  IVideoJobSnapshot,
  TProviderMediaResult,
} from '@robota-sdk/agent-core';
import { SeedanceVideoRuntime, type ISeedanceVideoRequest } from './runtime-core.js';

const MODEL = 'seedance-2.0';
const TEST_CREDENTIAL_ENV = 'TEST_VIDEO_PROVIDER_KEY';
const TEST_BASE_URL_ENV = 'TEST_VIDEO_PROVIDER_BASE_URL';
const createVideo = vi.fn();
const getVideoJob = vi.fn();
const cancelVideoJob = vi.fn();
const factoryCalls: IMediaProviderConfig[] = [];

function testDefinition(
  overrides: Partial<IMediaProviderDefinition> = {},
): IMediaProviderDefinition {
  return {
    type: 'test-video',
    createVideoProvider: (config) => {
      factoryCalls.push(config);
      return { createVideo, getVideoJob, cancelVideoJob } as unknown as IVideoGenerationProvider;
    },
    ...overrides,
  };
}

function credentialedDefinition(): IMediaProviderDefinition {
  return testDefinition({
    credentialRequirement: {
      credentialEnvVars: [TEST_CREDENTIAL_ENV],
      baseUrlEnvVars: [TEST_BASE_URL_ENV],
      requiresBaseUrl: true,
    },
  });
}

function accepted(): TProviderMediaResult<IVideoJobAccepted> {
  return {
    ok: true,
    value: { jobId: 'job-1', status: 'queued', createdAt: '2026-09-09T00:00:00Z' },
  };
}

function snapshot(
  overrides: Partial<IVideoJobSnapshot> = {},
): TProviderMediaResult<IVideoJobSnapshot> {
  return {
    ok: true,
    value: { jobId: 'job-1', status: 'running', updatedAt: '2026-09-09T00:00:01Z', ...overrides },
  };
}

function request(overrides: Partial<ISeedanceVideoRequest> = {}): ISeedanceVideoRequest {
  return { prompt: 'a drone shot', model: '', pollIntervalMs: 1, maxWaitMs: 1000, ...overrides };
}

function runtime(): SeedanceVideoRuntime {
  return new SeedanceVideoRuntime({
    videoProviderDefinition: testDefinition(),
    defaultModel: MODEL,
    sleep: async () => {},
  });
}

describe('SeedanceVideoRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    factoryCalls.length = 0;
    vi.stubEnv(TEST_CREDENTIAL_ENV, undefined);
    vi.stubEnv(TEST_BASE_URL_ENV, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a typed credential error without a provider definition', async () => {
    const result = await new SeedanceVideoRuntime({ defaultModel: MODEL }).generateVideo(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED');
    }
  });

  it('requires every credential field declared by the definition', async () => {
    vi.stubEnv(TEST_CREDENTIAL_ENV, 'key');
    const result = await new SeedanceVideoRuntime({
      videoProviderDefinition: credentialedDefinition(),
      defaultModel: MODEL,
      sleep: async () => {},
    }).generateVideo(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED');
    }
    expect(factoryCalls).toHaveLength(0);
  });

  it('resolves the declared credential and endpoint before creating the provider', async () => {
    vi.stubEnv(TEST_CREDENTIAL_ENV, 'key');
    vi.stubEnv(TEST_BASE_URL_ENV, 'https://api.test');
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue(
      snapshot({ status: 'succeeded', output: { kind: 'uri', uri: 'https://cdn.test/v.mp4' } }),
    );
    const result = await new SeedanceVideoRuntime({
      videoProviderDefinition: credentialedDefinition(),
      defaultModel: MODEL,
      sleep: async () => {},
    }).generateVideo(request());
    expect(result.ok).toBe(true);
    expect(factoryCalls.at(-1)).toEqual({ credential: 'key', baseUrl: 'https://api.test' });
  });

  it('polls a successful job and normalizes the video output', async () => {
    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(
      snapshot({
        status: 'succeeded',
        output: { kind: 'uri', uri: 'https://cdn.test/v.mp4', mimeType: 'video/mp4' },
      }),
    );
    const result = await runtime().generateVideo(
      request({ durationSeconds: 5, aspectRatio: '16:9' }),
    );
    expect(result.ok).toBe(true);
    expect(getVideoJob).toHaveBeenCalledTimes(2);
    expect(createVideo).toHaveBeenCalledWith({
      prompt: 'a drone shot',
      model: MODEL,
      durationSeconds: 5,
      aspectRatio: '16:9',
    });
  });

  it('maps provider failure and timeout to task errors', async () => {
    createVideo.mockResolvedValue({ ok: false, error: { code: 'UPSTREAM', message: 'failed' } });
    const failed = await runtime().generateVideo(request());
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_CREATE_FAILED');
    }

    createVideo.mockResolvedValue(accepted());
    getVideoJob.mockResolvedValue(snapshot());
    cancelVideoJob.mockResolvedValue(snapshot({ status: 'cancelled' }));
    const timedOut = await runtime().generateVideo(request({ maxWaitMs: 0 }));
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_VIDEO_TIMEOUT');
    expect(cancelVideoJob).toHaveBeenCalledWith('job-1');
  });
});
