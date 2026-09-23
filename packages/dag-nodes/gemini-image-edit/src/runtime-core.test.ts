import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPortBinaryValue } from '@robota-sdk/dag-core';
import type {
  IImageGenerationProvider,
  IImageGenerationResult,
  IMediaProviderConfig,
  IMediaProviderDefinition,
  TProviderMediaResult,
} from '@robota-sdk/agent-core';
import { GeminiImageRuntime, isImageBinaryValue } from './runtime-core.js';

const TEST_MODEL = 'test-image-model';
const TEST_CREDENTIAL_ENV = 'TEST_IMAGE_PROVIDER_KEY';
const editImage = vi.fn();
const composeImage = vi.fn();
const generateImage = vi.fn();
const factoryCalls: IMediaProviderConfig[] = [];

function testDefinition(
  overrides: Partial<IMediaProviderDefinition> = {},
): IMediaProviderDefinition {
  return {
    type: 'test-image',
    createImageProvider: (config) => {
      factoryCalls.push(config);
      return { editImage, composeImage, generateImage } as unknown as IImageGenerationProvider;
    },
    ...overrides,
  };
}

function credentialedDefinition(): IMediaProviderDefinition {
  return testDefinition({
    credentialRequirement: { credentialEnvVars: [TEST_CREDENTIAL_ENV] },
  });
}

function image(uri = 'data:image/png;base64,INPUT'): IPortBinaryValue {
  return { kind: 'image', mimeType: 'image/png', uri };
}

function success(): TProviderMediaResult<IImageGenerationResult> {
  return {
    ok: true,
    value: {
      model: TEST_MODEL,
      outputs: [{ kind: 'uri', uri: 'data:image/png;base64,RESULT', mimeType: 'image/png' }],
    },
  };
}

describe('GeminiImageRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    factoryCalls.length = 0;
    vi.stubEnv(TEST_CREDENTIAL_ENV, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('recognizes image binary values', () => {
    expect(isImageBinaryValue(image())).toBe(true);
    expect(isImageBinaryValue({ kind: 'video', mimeType: 'video/mp4', uri: 'x' })).toBe(false);
  });

  it('is constructible without a provider definition', () => {
    expect(new GeminiImageRuntime({ defaultModel: TEST_MODEL })).toBeDefined();
  });

  it('returns a typed model error when no model is configured', async () => {
    const result = await new GeminiImageRuntime({
      imageProviderDefinition: testDefinition(),
    }).editImage({ image: image(), prompt: 'blue', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_MODEL_REQUIRED');
  });

  it('returns a typed credential error when no definition is injected', async () => {
    const result = await new GeminiImageRuntime({ defaultModel: TEST_MODEL }).editImage({
      image: image(),
      prompt: 'blue',
      model: TEST_MODEL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_API_KEY_REQUIRED');
  });

  it('resolves the declared credential and model allowlist through the definition', async () => {
    vi.stubEnv(TEST_CREDENTIAL_ENV, 'test-key');
    editImage.mockResolvedValue(success());
    const result = await new GeminiImageRuntime({
      imageProviderDefinition: credentialedDefinition(),
      defaultModel: TEST_MODEL,
      allowedModels: [TEST_MODEL],
    }).editImage({ image: image(), prompt: 'blue', model: TEST_MODEL });
    expect(result.ok).toBe(true);
    expect(factoryCalls.at(-1)).toEqual({
      credential: 'test-key',
      imageCapableModels: [TEST_MODEL],
    });
  });

  it('rejects a model outside the injected allowlist', async () => {
    const result = await new GeminiImageRuntime({
      imageProviderDefinition: testDefinition(),
      defaultModel: TEST_MODEL,
      allowedModels: [TEST_MODEL],
    }).editImage({ image: image(), prompt: 'blue', model: 'other-model' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED');
  });

  it('maps edit and compose provider results to image values', async () => {
    editImage.mockResolvedValue(success());
    composeImage.mockResolvedValue(success());
    const runtime = new GeminiImageRuntime({
      imageProviderDefinition: testDefinition(),
      defaultModel: TEST_MODEL,
    });
    const edited = await runtime.editImage({ image: image(), prompt: 'blue', model: TEST_MODEL });
    const composed = await runtime.composeImages({
      images: [image(), image()],
      prompt: 'combine',
      model: TEST_MODEL,
    });
    expect(edited.ok).toBe(true);
    expect(composed.ok).toBe(true);
    expect(editImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'blue', model: TEST_MODEL }),
    );
    expect(composeImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'combine', model: TEST_MODEL }),
    );
  });

  it('rejects compose requests with fewer than two images', async () => {
    const result = await new GeminiImageRuntime({
      imageProviderDefinition: testDefinition(),
      defaultModel: TEST_MODEL,
    }).composeImages({ images: [image()], prompt: 'combine', model: TEST_MODEL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_MIN_ITEMS');
    }
  });

  it('maps provider failures and missing output to task errors', async () => {
    editImage.mockResolvedValue({ ok: false, error: { code: 'UPSTREAM', message: 'failed' } });
    const runtime = new GeminiImageRuntime({
      imageProviderDefinition: testDefinition(),
      defaultModel: TEST_MODEL,
    });
    const failed = await runtime.editImage({ image: image(), prompt: 'blue', model: TEST_MODEL });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED');

    editImage.mockResolvedValue({ ok: true, value: { model: TEST_MODEL, outputs: [] } });
    const missing = await runtime.editImage({ image: image(), prompt: 'blue', model: TEST_MODEL });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE');
    }
  });
});
