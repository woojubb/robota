import { mapInlineImagePartsToMediaOutputs } from './image-operations';

import type {
  TUniversalMessage,
  IChatOptions,
  IImageGenerationResult,
  TProviderMediaResult,
} from '@robota-sdk/agent-core';

/** Run an image generation request through the chat API. */
export async function runImageRequest(
  chatFn: (messages: TUniversalMessage[], options?: IChatOptions) => Promise<TUniversalMessage>,
  messages: TUniversalMessage[],
  model: string,
): Promise<TProviderMediaResult<IImageGenerationResult>> {
  try {
    const response = await chatFn(messages, {
      model,
      google: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const outputs = mapInlineImagePartsToMediaOutputs(response.parts);
    if (outputs.length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_UPSTREAM_ERROR',
          message: 'Google image response did not include image output parts.',
        },
      };
    }
    return { ok: true, value: { outputs, model } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Google image request failed.';
    return { ok: false, error: { code: 'PROVIDER_UPSTREAM_ERROR', message: errorMessage } };
  }
}
