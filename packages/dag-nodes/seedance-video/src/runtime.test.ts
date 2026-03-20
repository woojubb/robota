import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SeedanceVideoRuntime, type ISeedanceGenerateVideoRequest } from './runtime.js';
import { resolveImageInputSource } from './runtime-helpers.js';

// Mock BytedanceProvider
const mockCreateVideo = vi.fn();
const mockGetVideoJob = vi.fn();
vi.mock('@robota-sdk/agent-provider-bytedance', () => ({
  BytedanceProvider: vi.fn(() => ({
    createVideo: mockCreateVideo,
    getVideoJob: mockGetVideoJob,
    cancelVideoJob: vi.fn(),
  })),
}));

// Mock runtime-helpers
vi.mock('./runtime-helpers.js', () => ({
  resolveRuntimeBaseUrl: vi.fn(() => 'http://127.0.0.1:3011'),
  resolveImageInputSource: vi.fn(async (image: { uri?: string }) => ({
    ok: true,
    value: {
      kind: 'uri',
      uri: image.uri ?? 'https://img.example.com/img.png',
      mimeType: 'image/png',
    },
  })),
  toOutputVideo: vi.fn((output: Record<string, unknown>) => ({
    ok: true,
    value: {
      kind: 'video',
      mimeType: 'video/mp4',
      uri: output?.uri ?? 'https://cdn.example.com/video.mp4',
    },
  })),
}));

function createBaseRequest(
  overrides: Partial<ISeedanceGenerateVideoRequest> = {},
): ISeedanceGenerateVideoRequest {
  return {
    prompt: 'Generate a video of a sunset',
    model: 'seedance-1-5-pro-251215',
    pollIntervalMs: 10,
    pollTimeoutMs: 100,
    ...overrides,
  };
}

describe('SeedanceVideoRuntime', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    // Provide required env vars so provider is created
    process.env.BYTEDANCE_API_KEY = 'test-api-key';
    process.env.BYTEDANCE_BASE_URL = 'https://api.bytedance.com';
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  describe('config resolution', () => {
    it('returns validation error when no API key or base URL configured', async () => {
      delete process.env.BYTEDANCE_API_KEY;
      delete process.env.ARK_API_KEY;
      delete process.env.BYTEDANCE_BASE_URL;
      const runtime = new SeedanceVideoRuntime();
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_BYTEDANCE_CONFIG_REQUIRED');
      }
    });

    it('returns validation error when API key is present but base URL is missing', async () => {
      process.env.BYTEDANCE_API_KEY = 'test-key';
      delete process.env.BYTEDANCE_BASE_URL;
      const runtime = new SeedanceVideoRuntime();
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_BYTEDANCE_CONFIG_REQUIRED');
      }
    });

    it('uses ARK_API_KEY as fallback for BYTEDANCE_API_KEY', async () => {
      delete process.env.BYTEDANCE_API_KEY;
      process.env.ARK_API_KEY = 'ark-key';
      process.env.BYTEDANCE_BASE_URL = 'https://api.bytedance.com';
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4', mimeType: 'video/mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime();
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(true);
    });

    it('uses explicit options over env vars', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4', mimeType: 'video/mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'explicit-key',
        baseUrl: 'https://explicit.api.com',
      });
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(true);
    });

    it('uses DAG_SEEDANCE_DEFAULT_MODEL env var', async () => {
      process.env.DAG_SEEDANCE_DEFAULT_MODEL = 'custom-default';
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4', mimeType: 'video/mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime();
      // Use empty model to trigger default
      const result = await runtime.generateVideo(createBaseRequest({ model: '' }));
      expect(result.ok).toBe(true);
      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'custom-default' }),
      );
    });

    it('uses DAG_SEEDANCE_ALLOWED_MODELS env var for allowlist', async () => {
      process.env.DAG_SEEDANCE_ALLOWED_MODELS = 'model-a,model-b';
      const runtime = new SeedanceVideoRuntime();
      const result = await runtime.generateVideo(createBaseRequest({ model: 'disallowed-model' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_MODEL_NOT_ALLOWED');
      }
    });
  });

  describe('model validation', () => {
    it('rejects model not in allowedModels list', async () => {
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
        allowedModels: ['seedance-1-5-pro-251215'],
      });
      const result = await runtime.generateVideo(createBaseRequest({ model: 'not-allowed' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_MODEL_NOT_ALLOWED');
      }
    });

    it('accepts model that is in allowedModels list', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
        allowedModels: ['seedance-1-5-pro-251215', 'custom-model'],
      });
      const result = await runtime.generateVideo(createBaseRequest({ model: 'custom-model' }));
      expect(result.ok).toBe(true);
    });
  });

  describe('prompt validation', () => {
    it('returns error for empty prompt', async () => {
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest({ prompt: '' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED');
      }
    });

    it('returns error for whitespace-only prompt', async () => {
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest({ prompt: '   ' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED');
      }
    });
  });

  describe('image input resolution', () => {
    it('resolves input images and passes them to provider', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const images = [
        { kind: 'image' as const, mimeType: 'image/png', uri: 'https://img.example.com/img.png' },
      ];
      const result = await runtime.generateVideo(createBaseRequest({ inputImages: images }));
      expect(result.ok).toBe(true);
      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          inputImages: expect.arrayContaining([expect.objectContaining({ kind: 'uri' })]),
        }),
      );
    });

    it('returns error when image resolution fails', async () => {
      vi.mocked(resolveImageInputSource).mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND',
          message: 'Image not found',
          category: 'validation',
          retryable: false,
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const images = [{ kind: 'image' as const, mimeType: 'image/png', uri: 'asset://missing' }];
      const result = await runtime.generateVideo(createBaseRequest({ inputImages: images }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND');
      }
    });
  });

  describe('provider createVideo', () => {
    it('returns error when createVideo fails', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_UPSTREAM_ERROR', message: 'Upstream error' },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_CREATE_FAILED');
      }
    });
  });

  describe('polling loop', () => {
    it('succeeds on first poll with succeeded status', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4', mimeType: 'video/mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(true);
      expect(mockGetVideoJob).toHaveBeenCalledTimes(1);
    });

    it('polls multiple times before success', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob
        .mockResolvedValueOnce({
          ok: true,
          value: { jobId: 'job-1', status: 'running', updatedAt: '2025-01-01T00:00:30Z' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { jobId: 'job-1', status: 'running', updatedAt: '2025-01-01T00:00:45Z' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            jobId: 'job-1',
            status: 'succeeded',
            output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4' },
            updatedAt: '2025-01-01T00:01:00Z',
          },
        });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(
        createBaseRequest({ pollIntervalMs: 1, pollTimeoutMs: 5000 }),
      );
      expect(result.ok).toBe(true);
      expect(mockGetVideoJob).toHaveBeenCalledTimes(3);
    });

    it('returns non-retryable error when job fails', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'failed',
          error: { code: 'PROVIDER_UPSTREAM_ERROR', message: 'Content policy violation' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_JOB_FAILED');
        expect(result.error.retryable).toBe(false);
      }
    });

    it('uses default message when job fails without error', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'failed',
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('failed without explicit error message');
      }
    });

    it('returns non-retryable error when job is cancelled', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'cancelled',
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_JOB_CANCELLED');
        expect(result.error.retryable).toBe(false);
      }
    });

    it('returns retryable error on polling timeout', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      // Always return running so it times out
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'running', updatedAt: '2025-01-01T00:00:30Z' },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      // Very short timeout to trigger timeout quickly
      const result = await runtime.generateVideo(
        createBaseRequest({ pollIntervalMs: 1, pollTimeoutMs: 1 }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_TIMEOUT');
        expect(result.error.retryable).toBe(true);
      }
    });

    it('returns error when getVideoJob poll fails', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_JOB_NOT_FOUND', message: 'Job not found' },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      const result = await runtime.generateVideo(createBaseRequest());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_POLL_FAILED');
      }
    });
  });

  describe('request parameters', () => {
    it('passes durationSeconds, aspectRatio, seed to createVideo', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      await runtime.generateVideo(
        createBaseRequest({
          durationSeconds: 15,
          aspectRatio: '16:9',
          seed: 42,
        }),
      );
      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          durationSeconds: 15,
          aspectRatio: '16:9',
          seed: 42,
        }),
      );
    });

    it('does not pass inputImages when none provided', async () => {
      mockCreateVideo.mockResolvedValue({
        ok: true,
        value: { jobId: 'job-1', status: 'queued', createdAt: '2025-01-01T00:00:00Z' },
      });
      mockGetVideoJob.mockResolvedValue({
        ok: true,
        value: {
          jobId: 'job-1',
          status: 'succeeded',
          output: { kind: 'uri', uri: 'https://cdn.example.com/video.mp4' },
          updatedAt: '2025-01-01T00:01:00Z',
        },
      });
      const runtime = new SeedanceVideoRuntime({
        apiKey: 'key',
        baseUrl: 'https://api.example.com',
      });
      await runtime.generateVideo(createBaseRequest());
      expect(mockCreateVideo).toHaveBeenCalledWith(
        expect.objectContaining({ inputImages: undefined }),
      );
    });
  });
});
