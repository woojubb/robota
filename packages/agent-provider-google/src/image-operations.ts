import type {
  TUniversalMessage,
  TUniversalMessagePart,
  IMediaOutputRef,
  IImageEditRequest,
  IImageComposeRequest,
  TProviderMediaResult,
} from '@robota-sdk/agent-core';

/** Checks whether the given parts contain an image part. */
export function hasImagePart(parts: TUniversalMessagePart[] | undefined): boolean {
  if (!parts) {
    return false;
  }
  return parts.some((part) => part.type === 'image_inline' || part.type === 'image_uri');
}

/** Extracts inline image parts from a message and converts them to media output references. */
export function mapInlineImagePartsToMediaOutputs(
  parts: TUniversalMessagePart[] | undefined,
): IMediaOutputRef[] {
  if (!parts) {
    return [];
  }
  const outputs: IMediaOutputRef[] = [];
  for (const part of parts) {
    if (part.type !== 'image_inline') {
      continue;
    }
    outputs.push({
      kind: 'uri',
      uri: `data:${part.mimeType};base64,${part.data}`,
      mimeType: part.mimeType,
    });
  }
  return outputs;
}

/** Parses a data URI into its MIME type and base64 payload. */
export function parseDataUri(uri: string): { mimeType: string; data: string } | undefined {
  const commaIndex = uri.indexOf(',');
  if (commaIndex < 0) {
    return undefined;
  }
  const header = uri.slice(0, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  if (!header.endsWith(';base64')) {
    return undefined;
  }
  const mimeType = header.replace('data:', '').replace(';base64', '').trim();
  if (mimeType.length === 0 || payload.trim().length === 0) {
    return undefined;
  }
  return {
    mimeType,
    data: payload,
  };
}

/** Maps an image input source (inline or URI) to a universal message part. */
export function mapImageInputSourceToPart(
  source: IImageEditRequest['image'] | IImageComposeRequest['images'][number],
): TProviderMediaResult<TUniversalMessagePart> {
  if (source.kind === 'inline') {
    if (source.mimeType.trim().length === 0 || source.data.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_INVALID_REQUEST',
          message: 'Inline image source requires non-empty mimeType and data.',
        },
      };
    }
    return {
      ok: true,
      value: {
        type: 'image_inline',
        mimeType: source.mimeType,
        data: source.data,
      },
    };
  }
  if (!source.uri.startsWith('data:')) {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_INVALID_REQUEST',
        message: 'Google image provider supports only inline or data URI input sources.',
      },
    };
  }
  const parsedResult = parseDataUri(source.uri);
  if (!parsedResult) {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_INVALID_REQUEST',
        message: 'Data URI source must use base64 payload.',
      },
    };
  }
  return {
    ok: true,
    value: {
      type: 'image_inline',
      mimeType: parsedResult.mimeType,
      data: parsedResult.data,
    },
  };
}

/** Determines which response modalities to request from the Gemini API. */
export function buildResponseModalities(
  messages: TUniversalMessage[],
  defaultModalities: Array<'TEXT' | 'IMAGE'> | undefined,
  optionModalities: Array<'TEXT' | 'IMAGE'> | undefined,
): Array<'TEXT' | 'IMAGE'> {
  if (optionModalities && optionModalities.length > 0) {
    return optionModalities;
  }
  const hasImageInput = messages.some((message) => hasImagePart(message.parts));
  if (hasImageInput) {
    return ['TEXT', 'IMAGE'];
  }
  if (defaultModalities && defaultModalities.length > 0) {
    return defaultModalities;
  }
  return ['TEXT'];
}

/** Checks whether the specified model is configured as image-capable. */
export function isImageCapableModel(
  model: string,
  configuredImageModels: string[] | undefined,
): boolean {
  if (!configuredImageModels || configuredImageModels.length === 0) {
    return true;
  }
  return configuredImageModels.includes(model);
}

/** Builds the Gemini generation config including response modalities. */
export function buildGenerationConfig(
  messages: TUniversalMessage[],
  defaultModalities: Array<'TEXT' | 'IMAGE'> | undefined,
  imageCapableModels: string[] | undefined,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    google?: { responseModalities?: Array<'TEXT' | 'IMAGE'> };
  },
): {
  temperature?: number;
  maxOutputTokens?: number;
  responseModalities?: Array<'TEXT' | 'IMAGE'>;
} {
  const responseModalities = buildResponseModalities(
    messages,
    defaultModalities,
    options?.google?.responseModalities,
  );
  if (
    options?.model &&
    responseModalities.includes('IMAGE') &&
    !isImageCapableModel(options.model, imageCapableModels)
  ) {
    throw new Error(
      `Selected model "${options.model}" is not configured as image-capable for Google provider.`,
    );
  }
  return {
    temperature: options?.temperature,
    maxOutputTokens: options?.maxTokens,
    responseModalities,
  };
}
