import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IImageGenerationProvider,
  IImageGenerationResult,
  IMediaProviderConfig,
  IMediaProviderDefinition,
  TProviderMediaResult,
} from '@robota-sdk/agent-core';
import { TextToImageRuntime } from './runtime-core.js';

const TEST_MODEL = 'test-image-model';
const TEST_CREDENTIAL_ENV = 'TEST_IMAGE_PROVIDER_KEY';
const generateImage = vi.fn();
const factoryCalls: IMediaProviderConfig[] = [];

function testDefinition(
  overrides: Partial<IMediaProviderDefinition> = {},
): IMediaProviderDefinition {
  return {
    type: 'test-image',
    createImageProvider: (config) => {
      factoryCalls.push(config);
      return { generateImage } as unknown as IImageGenerationProvider;
    },
    ...overrides,
  };
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

describe('TextToImageRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    factoryCalls.length = 0;
    vi.stubEnv(TEST_CREDENTIAL_ENV, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a model error when neither request nor definition supplies a model', async () => {
    const result = await new TextToImageRuntime({
      imageProviderDefinition: testDefinition(),
    }).generateImage({ prompt: 'a cat', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_REQUIRED');
  });

  it('returns a typed credential error without a provider definition', async () => {
    const result = await new TextToImageRuntime({ defaultModel: TEST_MODEL }).generateImage({
      prompt: 'a cat',
      model: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED');
  });

  it('resolves the definition credential and passes image-capable models to the factory', async () => {
    vi.stubEnv(TEST_CREDENTIAL_ENV, 'test-key');
    generateImage.mockResolvedValue(success());
    const result = await new TextToImageRuntime({
      imageProviderDefinition: testDefinition({
        credentialRequirement: { credentialEnvVars: [TEST_CREDENTIAL_ENV] },
      }),
      defaultModel: TEST_MODEL,
      allowedModels: [TEST_MODEL],
    }).generateImage({ prompt: 'a cat', model: '' });
    expect(result.ok).toBe(true);
    expect(factoryCalls.at(-1)).toEqual({
      credential: 'test-key',
      imageCapableModels: [TEST_MODEL],
    });
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'a cat', model: TEST_MODEL });
  });

  it('rejects models outside the injected allowlist', async () => {
    const result = await new TextToImageRuntime({
      imageProviderDefinition: testDefinition(),
      defaultModel: TEST_MODEL,
      allowedModels: [TEST_MODEL],
    }).generateImage({ prompt: 'a cat', model: 'other-model' });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe('DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED');
  });

  it('maps provider failures and missing outputs to task errors', async () => {
    const runtime = new TextToImageRuntime({
      imageProviderDefinition: testDefinition(),
      defaultModel: TEST_MODEL,
    });
    generateImage.mockResolvedValue({ ok: false, error: { code: 'UPSTREAM', message: 'boom' } });
    const failed = await runtime.generateImage({ prompt: 'a cat', model: '' });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('DAG_TASK_EXECUTION_TEXT_TO_IMAGE_FAILED');

    generateImage.mockResolvedValue({ ok: true, value: { model: TEST_MODEL, outputs: [] } });
    const missing = await runtime.generateImage({ prompt: 'a cat', model: '' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('DAG_TASK_EXECUTION_TEXT_TO_IMAGE_RESPONSE_MISSING_IMAGE');
    }
  });
});
