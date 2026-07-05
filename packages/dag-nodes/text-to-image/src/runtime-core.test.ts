import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IImageGenerationResult, TProviderMediaResult } from '@robota-sdk/agent-core';
import { TextToImageRuntime } from './runtime-core.js';
import { GoogleProvider } from '@robota-sdk/agent-provider/google';

// A shared generateImage mock so every constructed GoogleProvider instance uses the same fn —
// lets us set the return value before the runtime constructs the provider. The factory lives in
// vi.hoisted so the vi.mock() call stays a single line (keeps the allow-module-mock escape attached).
const { sharedGenerateImage, googleMockFactory } = vi.hoisted(() => {
  const sharedGenerateImage = vi.fn();
  const googleMockFactory = (): { GoogleProvider: unknown } => ({
    GoogleProvider: vi
      .fn()
      .mockImplementation((options: { apiKey: string; imageCapableModels: string[] }) => ({
        _apiKey: options.apiKey,
        _imageCapableModels: options.imageCapableModels,
        generateImage: sharedGenerateImage,
      })),
  });
  return { sharedGenerateImage, googleMockFactory };
});

// Full replacement avoids loading the @google/genai SDK; only ctor + generateImage are exercised.
vi.mock('@robota-sdk/agent-provider/google', googleMockFactory); // allow-module-mock: GoogleProvider hits the real Gemini API

const TEST_MODEL = 'test-image-model';

function makeSuccessResult(): TProviderMediaResult<IImageGenerationResult> {
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

describe('TextToImageRuntime', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    savedEnv = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      DAG_TEXT_TO_IMAGE_DEFAULT_MODEL: process.env.DAG_TEXT_TO_IMAGE_DEFAULT_MODEL,
      DAG_TEXT_TO_IMAGE_ALLOWED_MODELS: process.env.DAG_TEXT_TO_IMAGE_ALLOWED_MODELS,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.DAG_TEXT_TO_IMAGE_DEFAULT_MODEL;
    delete process.env.DAG_TEXT_TO_IMAGE_ALLOWED_MODELS;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns validation error when default model is missing', async () => {
    const runtime = new TextToImageRuntime({ apiKey: 'k' });
    const result = await runtime.generateImage({ prompt: 'a cat', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_REQUIRED');
  });

  it('returns validation error when API key is missing', async () => {
    const runtime = new TextToImageRuntime({ defaultModel: TEST_MODEL });
    const result = await runtime.generateImage({ prompt: 'a cat', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED');
  });

  it('returns validation error when model is not allowed', async () => {
    const runtime = new TextToImageRuntime({
      apiKey: 'k',
      defaultModel: TEST_MODEL,
      allowedModels: ['only-this-one'],
    });
    const result = await runtime.generateImage({ prompt: 'a cat', model: 'some-other-model' });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED');
  });

  it('maps a successful provider response to an image port value', async () => {
    sharedGenerateImage.mockResolvedValue(makeSuccessResult());
    const runtime = new TextToImageRuntime({ apiKey: 'k', defaultModel: TEST_MODEL });
    const result = await runtime.generateImage({ prompt: 'a cat', model: '' });
    expect(GoogleProvider).toHaveBeenCalledWith({ apiKey: 'k', imageCapableModels: [] });
    expect(sharedGenerateImage).toHaveBeenCalledWith({ prompt: 'a cat', model: TEST_MODEL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('image');
      expect(result.value.mimeType).toBe('image/png');
      expect(result.value.uri).toContain('data:image/png;base64,RESULT_DATA');
    }
  });

  it('maps a provider failure to a task execution error', async () => {
    sharedGenerateImage.mockResolvedValue({
      ok: false,
      error: { code: 'PROVIDER_ERROR', message: 'boom' },
    });
    const runtime = new TextToImageRuntime({ apiKey: 'k', defaultModel: TEST_MODEL });
    const result = await runtime.generateImage({ prompt: 'a cat', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_TASK_EXECUTION_TEXT_TO_IMAGE_FAILED');
  });

  it('errors when the provider returns no outputs', async () => {
    sharedGenerateImage.mockResolvedValue({ ok: true, value: { model: TEST_MODEL, outputs: [] } });
    const runtime = new TextToImageRuntime({ apiKey: 'k', defaultModel: TEST_MODEL });
    const result = await runtime.generateImage({ prompt: 'a cat', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_TEXT_TO_IMAGE_RESPONSE_MISSING_IMAGE');
    }
  });

  it('resolves the model from config over the default', async () => {
    sharedGenerateImage.mockResolvedValue(makeSuccessResult());
    const runtime = new TextToImageRuntime({ apiKey: 'k', defaultModel: TEST_MODEL });
    await runtime.generateImage({ prompt: 'a cat', model: 'chosen-model' });
    expect(sharedGenerateImage).toHaveBeenCalledWith({ prompt: 'a cat', model: 'chosen-model' });
  });
});
