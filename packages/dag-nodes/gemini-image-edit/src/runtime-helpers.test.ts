import { describe, it, expect } from 'vitest';
import type { IMediaOutputRef } from '@robota-sdk/agent-core';
import type { IPortBinaryValue } from '@robota-sdk/dag-core';
import { resolveModel, normalizeImageOutput } from './runtime-helpers.js';
import { isImageBinaryValue } from './runtime-core.js';

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------
describe('resolveModel', () => {
  const allowedModels = ['gemini-2.5-flash-image', 'gemini-2.0-flash-exp'];
  const defaultModel = 'gemini-2.5-flash-image';

  it('returns selected model when it is in the allowed list', () => {
    const result = resolveModel('gemini-2.0-flash-exp', defaultModel, allowedModels);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('gemini-2.0-flash-exp');
    }
  });

  it('returns error when selected model is not in the allowed list', () => {
    const result = resolveModel('gemini-unknown-model', defaultModel, allowedModels);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED');
    }
  });

  it('falls back to default model when selectedModel is empty', () => {
    const result = resolveModel('', defaultModel, allowedModels);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(defaultModel);
    }
  });

  it('falls back to default model when selectedModel is whitespace-only', () => {
    const result = resolveModel('   ', defaultModel, allowedModels);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(defaultModel);
    }
  });

  it('accepts any model when allowedModels is empty', () => {
    const result = resolveModel('any-model-at-all', defaultModel, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('any-model-at-all');
    }
  });

  it('trims whitespace from selectedModel before checking', () => {
    const result = resolveModel('  gemini-2.0-flash-exp  ', defaultModel, allowedModels);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('gemini-2.0-flash-exp');
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeImageOutput
// ---------------------------------------------------------------------------
describe('normalizeImageOutput', () => {
  it('normalizes asset output with valid assetId and mimeType', () => {
    const output: IMediaOutputRef = {
      kind: 'asset',
      assetId: 'abc-123',
      mimeType: 'image/png',
      bytes: 1024,
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'image',
        mimeType: 'image/png',
        uri: 'asset://abc-123',
        referenceType: 'asset',
        assetId: 'abc-123',
        sizeBytes: 1024,
      });
    }
  });

  it('returns error when asset output has missing assetId', () => {
    const output: IMediaOutputRef = {
      kind: 'asset',
      mimeType: 'image/png',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_ASSET_INVALID');
    }
  });

  it('returns error when asset output has empty assetId', () => {
    const output: IMediaOutputRef = {
      kind: 'asset',
      assetId: '   ',
      mimeType: 'image/png',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_ASSET_INVALID');
    }
  });

  it('returns error when asset output has non-image mimeType', () => {
    const output: IMediaOutputRef = {
      kind: 'asset',
      assetId: 'abc-123',
      mimeType: 'application/json',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID');
    }
  });

  it('returns error when asset output has missing mimeType', () => {
    const output: IMediaOutputRef = {
      kind: 'asset',
      assetId: 'abc-123',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID');
    }
  });

  it('normalizes data URI output', () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const output: IMediaOutputRef = {
      kind: 'uri',
      uri: dataUri,
      mimeType: 'image/jpeg',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'image',
        mimeType: 'image/jpeg',
        uri: dataUri,
        referenceType: 'uri',
      });
    }
  });

  it('returns error for invalid data URI', () => {
    const output: IMediaOutputRef = {
      kind: 'uri',
      uri: 'data:not-valid',
      mimeType: 'image/png',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED');
    }
  });

  it('returns error for data URI with non-image mimeType', () => {
    const output: IMediaOutputRef = {
      kind: 'uri',
      uri: 'data:text/plain;base64,SGVsbG8=',
      mimeType: 'text/plain',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED');
    }
  });

  it('normalizes http URI output with valid image mimeType', () => {
    const output: IMediaOutputRef = {
      kind: 'uri',
      uri: 'https://example.com/image.png',
      mimeType: 'image/png',
      bytes: 2048,
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'image',
        mimeType: 'image/png',
        uri: 'https://example.com/image.png',
        referenceType: 'uri',
        sizeBytes: 2048,
      });
    }
  });

  it('returns error for http URI output with non-image mimeType', () => {
    const output: IMediaOutputRef = {
      kind: 'uri',
      uri: 'https://example.com/file.pdf',
      mimeType: 'application/pdf',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID');
    }
  });

  it('returns error for http URI output with missing mimeType', () => {
    const output: IMediaOutputRef = {
      kind: 'uri',
      uri: 'https://example.com/image.png',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID');
    }
  });

  it('returns error when uri output has missing uri value', () => {
    const output: IMediaOutputRef = {
      kind: 'uri',
      mimeType: 'image/png',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING');
    }
  });

  it('returns error when uri output has empty uri value', () => {
    const output: IMediaOutputRef = {
      kind: 'uri',
      uri: '   ',
      mimeType: 'image/png',
    };
    const result = normalizeImageOutput(output);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING');
    }
  });
});

// ---------------------------------------------------------------------------
// isImageBinaryValue
// ---------------------------------------------------------------------------
describe('isImageBinaryValue', () => {
  it('returns false for null', () => {
    expect(isImageBinaryValue(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isImageBinaryValue(undefined)).toBe(false);
  });

  it('returns false when kind is not image', () => {
    const value: Partial<IPortBinaryValue> = {
      kind: 'audio',
      mimeType: 'audio/mp3',
      uri: 'asset://abc',
    };
    expect(isImageBinaryValue(value)).toBe(false);
  });

  it('returns false when mimeType is missing', () => {
    const value: Partial<IPortBinaryValue> = {
      kind: 'image',
      uri: 'asset://abc',
    };
    expect(isImageBinaryValue(value)).toBe(false);
  });

  it('returns false when uri is missing', () => {
    const value: Partial<IPortBinaryValue> = {
      kind: 'image',
      mimeType: 'image/png',
    };
    expect(isImageBinaryValue(value)).toBe(false);
  });

  it('returns true for valid image binary value', () => {
    const value: Partial<IPortBinaryValue> = {
      kind: 'image',
      mimeType: 'image/png',
      uri: 'asset://abc-123',
    };
    expect(isImageBinaryValue(value)).toBe(true);
  });

  it('returns true for valid image with all optional fields', () => {
    const value: IPortBinaryValue = {
      kind: 'image',
      mimeType: 'image/jpeg',
      uri: 'asset://def-456',
      referenceType: 'asset',
      assetId: 'def-456',
      sizeBytes: 4096,
    };
    expect(isImageBinaryValue(value)).toBe(true);
  });
});
