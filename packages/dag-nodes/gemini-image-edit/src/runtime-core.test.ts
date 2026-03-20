import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPortBinaryValue } from '@robota-sdk/dag-core';
import type { IImageGenerationResult, TProviderMediaResult } from '@robota-sdk/agent-core';
import { GeminiImageRuntime, isImageBinaryValue } from './runtime-core.js';
import { GoogleProvider } from '@robota-sdk/agent-provider-google';

// Mock GoogleProvider so no real API calls are made
vi.mock('@robota-sdk/agent-provider-google', () => ({
  GoogleProvider: vi
    .fn()
    .mockImplementation((options: { apiKey: string; imageCapableModels: string[] }) => ({
      _apiKey: options.apiKey,
      _imageCapableModels: options.imageCapableModels,
      editImage: vi.fn(),
      composeImage: vi.fn(),
      generateImage: vi.fn(),
    })),
}));

// Mock fetch globally for toInlineImageSource resolution
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const TEST_MODEL = 'test-image-model';

function makeImageBinary(overrides?: Partial<IPortBinaryValue>): IPortBinaryValue {
  return {
    kind: 'image',
    mimeType: 'image/png',
    uri: 'data:image/png;base64,iVBOR',
    ...overrides,
  };
}

function makeSuccessEditResult(): TProviderMediaResult<IImageGenerationResult> {
  return {
    ok: true,
    value: {
      model: TEST_MODEL,
      outputs: [
        {
          kind: 'uri',
          uri: 'data:image/png;base64,RESULT_DATA',
          mimeType: 'image/png',
          bytes: 2048,
        },
      ],
    },
  };
}

function makeSuccessComposeResult(): TProviderMediaResult<IImageGenerationResult> {
  return {
    ok: true,
    value: {
      model: TEST_MODEL,
      outputs: [
        {
          kind: 'uri',
          uri: 'data:image/png;base64,COMPOSED_DATA',
          mimeType: 'image/png',
          bytes: 4096,
        },
      ],
    },
  };
}

describe('GeminiImageRuntime', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      DAG_GEMINI_IMAGE_DEFAULT_MODEL: process.env.DAG_GEMINI_IMAGE_DEFAULT_MODEL,
      DAG_GEMINI_IMAGE_ALLOWED_MODELS: process.env.DAG_GEMINI_IMAGE_ALLOWED_MODELS,
      DAG_RUNTIME_BASE_URL: process.env.DAG_RUNTIME_BASE_URL,
      DAG_PORT: process.env.DAG_PORT,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.DAG_GEMINI_IMAGE_DEFAULT_MODEL;
    delete process.env.DAG_GEMINI_IMAGE_ALLOWED_MODELS;
    delete process.env.DAG_RUNTIME_BASE_URL;
    delete process.env.DAG_PORT;
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('creates runtime with default options', () => {
      const runtime = new GeminiImageRuntime();
      expect(runtime).toBeDefined();
    });

    it('creates runtime with explicit options', () => {
      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: 'gemini-2.0-flash-exp',
        allowedModels: ['gemini-2.0-flash-exp'],
      });
      expect(runtime).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // editImage
  // -----------------------------------------------------------------------
  describe('editImage', () => {
    it('returns model required error when no model is configured', async () => {
      const runtime = new GeminiImageRuntime({ apiKey: 'test-key' });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: '',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_MODEL_REQUIRED');
      }
    });

    it('returns API key required error when no API key is configured', async () => {
      const runtime = new GeminiImageRuntime({ defaultModel: TEST_MODEL });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_API_KEY_REQUIRED');
      }
    });

    it('returns model not allowed error when model is not in allowlist', async () => {
      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
        allowedModels: [TEST_MODEL],
      });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: 'gemini-unknown-model',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED');
      }
    });

    it('successfully edits an image with data URI input', async () => {
      const mockEditImage = vi.fn().mockResolvedValue(makeSuccessEditResult());
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: mockEditImage,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe('image');
      }
    });

    it('returns error when provider editImage call fails', async () => {
      const mockEditImage = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'PROVIDER_UPSTREAM_ERROR',
          message: 'Upstream failed',
        },
      });
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: mockEditImage,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED');
      }
    });

    it('returns error when provider response has no image output', async () => {
      const mockEditImage = vi.fn().mockResolvedValue({
        ok: true,
        value: { model: TEST_MODEL, outputs: [] },
      });
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: mockEditImage,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE');
      }
    });

    it('uses env GEMINI_API_KEY when no explicit key given', async () => {
      process.env.GEMINI_API_KEY = 'env-test-key';

      const mockEditImage = vi.fn().mockResolvedValue(makeSuccessEditResult());
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: mockEditImage,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({ defaultModel: TEST_MODEL });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(true);
    });

    it('uses env DAG_GEMINI_IMAGE_DEFAULT_MODEL for default model', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.DAG_GEMINI_IMAGE_DEFAULT_MODEL = 'gemini-2.0-flash-exp';

      const mockEditImage = vi.fn().mockResolvedValue(makeSuccessEditResult());
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: mockEditImage,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime();
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: '', // falls back to env default model
      });
      expect(result.ok).toBe(true);
    });

    it('uses env DAG_GEMINI_IMAGE_ALLOWED_MODELS as CSV', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.DAG_GEMINI_IMAGE_DEFAULT_MODEL = 'model-a';
      process.env.DAG_GEMINI_IMAGE_ALLOWED_MODELS = 'model-a, model-b';

      const mockEditImage = vi.fn().mockResolvedValue(makeSuccessEditResult());
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: mockEditImage,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime();
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: 'model-a',
      });
      expect(result.ok).toBe(true);
    });

    it('allows any model when no allowlist is configured', async () => {
      const mockEditImage = vi.fn().mockResolvedValue(makeSuccessEditResult());
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: mockEditImage,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: 'any-arbitrary-model',
      });
      expect(result.ok).toBe(true);
    });

    it('returns error when provider lacks editImage capability', async () => {
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: undefined,
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({ apiKey: 'test-key', defaultModel: TEST_MODEL });
      const result = await runtime.editImage({
        image: makeImageBinary(),
        prompt: 'Make it blue',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_API_KEY_REQUIRED');
      }
    });

    it('returns error when input image resolution fails for asset ref', async () => {
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: vi.fn(),
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      mockFetch.mockResolvedValue({
        ok: false,
        body: null,
      });

      const runtime = new GeminiImageRuntime({ apiKey: 'test-key', defaultModel: TEST_MODEL });
      const result = await runtime.editImage({
        image: makeImageBinary({
          uri: 'asset://test-asset-id',
          referenceType: 'asset',
          assetId: 'test-asset-id',
        }),
        prompt: 'Make it blue',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // composeImages
  // -----------------------------------------------------------------------
  describe('composeImages', () => {
    it('returns model required error when no model is configured', async () => {
      const runtime = new GeminiImageRuntime({ apiKey: 'test-key' });
      const result = await runtime.composeImages({
        images: [makeImageBinary(), makeImageBinary()],
        prompt: 'Combine these images',
        model: '',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_MODEL_REQUIRED');
      }
    });

    it('returns API key required error when no API key is configured', async () => {
      const runtime = new GeminiImageRuntime({ defaultModel: TEST_MODEL });
      const result = await runtime.composeImages({
        images: [makeImageBinary(), makeImageBinary()],
        prompt: 'Combine these images',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_API_KEY_REQUIRED');
      }
    });

    it('returns model not allowed error for disallowed model', async () => {
      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
        allowedModels: [TEST_MODEL],
      });
      const result = await runtime.composeImages({
        images: [makeImageBinary(), makeImageBinary()],
        prompt: 'Combine these images',
        model: 'unknown-model',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED');
      }
    });

    it('returns error when fewer than 2 images are provided', async () => {
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: vi.fn(),
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.composeImages({
        images: [makeImageBinary()],
        prompt: 'Combine these images',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_MIN_ITEMS');
      }
    });

    it('successfully composes images with data URI inputs', async () => {
      const mockComposeImage = vi.fn().mockResolvedValue(makeSuccessComposeResult());
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: vi.fn(),
            composeImage: mockComposeImage,
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.composeImages({
        images: [makeImageBinary(), makeImageBinary()],
        prompt: 'Combine these images',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe('image');
      }
    });

    it('returns error when provider composeImage call fails', async () => {
      const mockComposeImage = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'PROVIDER_UPSTREAM_ERROR',
          message: 'Compose failed',
        },
      });
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: vi.fn(),
            composeImage: mockComposeImage,
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.composeImages({
        images: [makeImageBinary(), makeImageBinary()],
        prompt: 'Combine these images',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED');
      }
    });

    it('returns error when compose response has no image output', async () => {
      const mockComposeImage = vi.fn().mockResolvedValue({
        ok: true,
        value: { model: TEST_MODEL, outputs: [] },
      });
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: vi.fn(),
            composeImage: mockComposeImage,
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.composeImages({
        images: [makeImageBinary(), makeImageBinary()],
        prompt: 'Combine these images',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE');
      }
    });

    it('returns error when one compose input image fails to resolve', async () => {
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: vi.fn(),
            composeImage: vi.fn(),
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          body: true,
          headers: new Headers({ 'content-type': 'image/png' }),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        })
        .mockResolvedValueOnce({
          ok: false,
          body: null,
        });

      const runtime = new GeminiImageRuntime({
        apiKey: 'test-key',
        defaultModel: TEST_MODEL,
      });
      const result = await runtime.composeImages({
        images: [
          makeImageBinary({ uri: 'asset://img1', referenceType: 'asset', assetId: 'img1' }),
          makeImageBinary({ uri: 'asset://img2', referenceType: 'asset', assetId: 'img2' }),
        ],
        prompt: 'Combine these images',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
    });

    it('returns error when provider lacks composeImage capability', async () => {
      vi.mocked(GoogleProvider).mockImplementation(
        () =>
          ({
            editImage: vi.fn(),
            composeImage: undefined,
            generateImage: vi.fn(),
          }) as unknown as InstanceType<typeof GoogleProvider>,
      );

      const runtime = new GeminiImageRuntime({ apiKey: 'test-key', defaultModel: TEST_MODEL });
      const result = await runtime.composeImages({
        images: [makeImageBinary(), makeImageBinary()],
        prompt: 'Combine these images',
        model: TEST_MODEL,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_API_KEY_REQUIRED');
      }
    });
  });
});

// -----------------------------------------------------------------------
// isImageBinaryValue (additional edge cases)
// -----------------------------------------------------------------------
describe('isImageBinaryValue edge cases', () => {
  it('returns false for empty object', () => {
    expect(isImageBinaryValue({} as Partial<IPortBinaryValue>)).toBe(false);
  });

  it('returns false when mimeType is non-string', () => {
    const value = {
      kind: 'image',
      mimeType: 123,
      uri: 'test',
    } as unknown as Partial<IPortBinaryValue>;
    expect(isImageBinaryValue(value)).toBe(false);
  });

  it('returns false when uri is non-string', () => {
    const value = {
      kind: 'image',
      mimeType: 'image/png',
      uri: 123,
    } as unknown as Partial<IPortBinaryValue>;
    expect(isImageBinaryValue(value)).toBe(false);
  });
});
