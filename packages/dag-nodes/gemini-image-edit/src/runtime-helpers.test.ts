import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IMediaOutputRef } from '@robota-sdk/agent-core';
import type { IPortBinaryValue } from '@robota-sdk/dag-core';
import {
  parseCsv,
  resolveRuntimeBaseUrl,
  resolveModel,
  normalizeImageOutput,
} from './runtime-helpers.js';
import { isImageBinaryValue } from './runtime-core.js';

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------
describe('parseCsv', () => {
  it('returns empty array for undefined input', () => {
    expect(parseCsv(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('parses comma-separated values', () => {
    expect(parseCsv('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace around items', () => {
    expect(parseCsv(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty segments', () => {
    expect(parseCsv('a,,b, ,c')).toEqual(['a', 'b', 'c']);
  });

  it('returns single-element array for value without commas', () => {
    expect(parseCsv('only-one')).toEqual(['only-one']);
  });
});

// ---------------------------------------------------------------------------
// resolveRuntimeBaseUrl
// ---------------------------------------------------------------------------
describe('resolveRuntimeBaseUrl', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      DAG_RUNTIME_BASE_URL: process.env.DAG_RUNTIME_BASE_URL,
      DAG_PORT: process.env.DAG_PORT,
    };
    delete process.env.DAG_RUNTIME_BASE_URL;
    delete process.env.DAG_PORT;
  });

  afterEach(() => {
    if (savedEnv.DAG_RUNTIME_BASE_URL === undefined) {
      delete process.env.DAG_RUNTIME_BASE_URL;
    } else {
      process.env.DAG_RUNTIME_BASE_URL = savedEnv.DAG_RUNTIME_BASE_URL;
    }
    if (savedEnv.DAG_PORT === undefined) {
      delete process.env.DAG_PORT;
    } else {
      process.env.DAG_PORT = savedEnv.DAG_PORT;
    }
  });

  it('returns DAG_RUNTIME_BASE_URL when set', () => {
    process.env.DAG_RUNTIME_BASE_URL = 'https://my-runtime.example.com';
    expect(resolveRuntimeBaseUrl()).toBe('https://my-runtime.example.com');
  });

  it('strips trailing slash from DAG_RUNTIME_BASE_URL', () => {
    process.env.DAG_RUNTIME_BASE_URL = 'https://my-runtime.example.com/';
    expect(resolveRuntimeBaseUrl()).toBe('https://my-runtime.example.com');
  });

  it('ignores whitespace-only DAG_RUNTIME_BASE_URL', () => {
    process.env.DAG_RUNTIME_BASE_URL = '   ';
    expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
  });

  it('uses DAG_PORT when DAG_RUNTIME_BASE_URL is not set', () => {
    process.env.DAG_PORT = '4000';
    expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:4000');
  });

  it('falls back to default port 3011 when no env vars are set', () => {
    expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
  });

  it('falls back to default port when DAG_PORT is not a valid number', () => {
    process.env.DAG_PORT = 'notanumber';
    expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
  });

  it('falls back to default port when DAG_PORT is zero', () => {
    process.env.DAG_PORT = '0';
    expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
  });

  it('falls back to default port when DAG_PORT is negative', () => {
    process.env.DAG_PORT = '-1';
    expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
  });
});

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
