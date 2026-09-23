import { BytedanceProvider } from '@robota-sdk/agent-provider-bytedance';
import { GoogleProvider } from '@robota-sdk/agent-provider-gemini/google';

import type { IMediaProviderDefinition } from '@robota-sdk/agent-core';

export const GEMINI_IMAGE_MEDIA_PROVIDER_TYPE = 'gemini-image';
export const SEEDANCE_VIDEO_MEDIA_PROVIDER_TYPE = 'seedance-video';

export function createGeminiImageProviderDefinition(): IMediaProviderDefinition {
  return {
    type: GEMINI_IMAGE_MEDIA_PROVIDER_TYPE,
    displayName: 'Gemini (image)',
    defaults: { model: 'gemini-2.5-flash-image' },
    credentialRequirement: { credentialEnvVars: ['GEMINI_API_KEY'] },
    createImageProvider: (config) =>
      new GoogleProvider({
        apiKey: config.credential ?? '',
        ...(config.imageCapableModels !== undefined
          ? { imageCapableModels: [...config.imageCapableModels] }
          : {}),
      }),
  };
}

export function createSeedanceVideoProviderDefinition(): IMediaProviderDefinition {
  return {
    type: SEEDANCE_VIDEO_MEDIA_PROVIDER_TYPE,
    displayName: 'Seedance (video)',
    defaults: { model: 'seedance-2.0' },
    credentialRequirement: {
      credentialEnvVars: ['SEEDANCE_API_KEY'],
      baseUrlEnvVars: ['SEEDANCE_BASE_URL'],
      requiresBaseUrl: true,
    },
    createVideoProvider: (config) =>
      new BytedanceProvider({
        apiKey: config.credential ?? '',
        baseUrl: config.baseUrl ?? '',
      }),
  };
}

export function createDefaultMediaProviderDefinitions(): readonly IMediaProviderDefinition[] {
  return [createGeminiImageProviderDefinition(), createSeedanceVideoProviderDefinition()];
}
