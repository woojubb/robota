import { describe, expect, it, vi } from 'vitest';
import { createRecordEnvResolver } from '../../utils/env-resolver.js';
import {
  createImageProviderFromDefinition,
  createVideoProviderFromDefinition,
  resolveMediaProviderConfig,
} from '../media-provider-factory.js';
import {
  findMediaProviderDefinition,
  isMediaProviderDefinition,
} from '../../interfaces/media-provider-definition.js';
import type {
  IMediaProviderConfig,
  IMediaProviderDefinition,
} from '../../interfaces/media-provider-definition.js';
import type {
  IImageGenerationProvider,
  IVideoGenerationProvider,
} from '../../interfaces/media-provider.js';

const calls: IMediaProviderConfig[] = [];

function imageDefinition(
  overrides: Partial<IMediaProviderDefinition> = {},
): IMediaProviderDefinition {
  return {
    type: 'test-image',
    credentialRequirement: { credentialEnvVars: ['TEST_IMAGE_KEY'] },
    createImageProvider: (config) => {
      calls.push(config);
      return { generateImage: vi.fn() } as unknown as IImageGenerationProvider;
    },
    ...overrides,
  };
}

function videoDefinition(
  overrides: Partial<IMediaProviderDefinition> = {},
): IMediaProviderDefinition {
  return {
    type: 'test-video',
    credentialRequirement: {
      credentialEnvVars: ['TEST_VIDEO_KEY'],
      baseUrlEnvVars: ['TEST_VIDEO_BASE_URL'],
      requiresBaseUrl: true,
    },
    createVideoProvider: (config) => {
      calls.push(config);
      return {
        createVideo: vi.fn(),
        getVideoJob: vi.fn(),
        cancelVideoJob: vi.fn(),
      } as unknown as IVideoGenerationProvider;
    },
    ...overrides,
  };
}

describe('resolveMediaProviderConfig', () => {
  it('resolves the first declared credential variable that is set', () => {
    const result = resolveMediaProviderConfig(
      imageDefinition({
        credentialRequirement: { credentialEnvVars: ['FIRST_KEY', 'SECOND_KEY'] },
      }),
      {},
      createRecordEnvResolver({ SECOND_KEY: 'second' }),
    );
    expect(result).toEqual({ ok: true, config: { credential: 'second' } });
  });

  it('reports missing credentials and required endpoints', () => {
    const image = resolveMediaProviderConfig(imageDefinition(), {}, createRecordEnvResolver({}));
    expect(image).toEqual({ ok: false, missing: ['TEST_IMAGE_KEY'] });
    const video = resolveMediaProviderConfig(
      videoDefinition(),
      {},
      createRecordEnvResolver({ TEST_VIDEO_KEY: 'key' }),
    );
    expect(video).toEqual({ ok: false, missing: ['TEST_VIDEO_BASE_URL'] });
  });

  it('uses injected environment only', () => {
    vi.stubEnv('TEST_IMAGE_KEY', 'ambient');
    try {
      const result = resolveMediaProviderConfig(imageDefinition(), {}, createRecordEnvResolver({}));
      expect(result.ok).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('media provider factories', () => {
  it('returns undefined when credentials or capability are unavailable', () => {
    expect(
      createImageProviderFromDefinition(imageDefinition(), {}, createRecordEnvResolver({})),
    ).toBeUndefined();
    expect(
      createVideoProviderFromDefinition(
        imageDefinition(),
        {},
        createRecordEnvResolver({ TEST_IMAGE_KEY: 'key' }),
      ),
    ).toBeUndefined();
  });

  it('passes the resolved image model allowlist to the definition factory', () => {
    calls.length = 0;
    expect(
      createImageProviderFromDefinition(
        imageDefinition(),
        { imageCapableModels: ['a', 'b'] },
        createRecordEnvResolver({ TEST_IMAGE_KEY: 'key' }),
      ),
    ).toBeDefined();
    expect(calls.at(-1)).toEqual({ credential: 'key', imageCapableModels: ['a', 'b'] });
  });

  it('rejects a definition that has no usable factory', () => {
    expect(isMediaProviderDefinition({ type: 'empty' })).toBe(false);
    expect(isMediaProviderDefinition(imageDefinition())).toBe(true);
    expect(
      findMediaProviderDefinition([imageDefinition(), videoDefinition()], 'test-video'),
    ).toBeDefined();
  });
});
