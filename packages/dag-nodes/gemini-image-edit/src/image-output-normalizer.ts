import {
  buildTaskExecutionError,
  type IDagError,
  type IPortBinaryValue,
  type TResult,
} from '@robota-sdk/dag-core';
import type { IMediaOutputRef } from '@robota-sdk/agent-core';

/**
 * Normalizes a provider media output reference into a standard binary port value.
 *
 * Handles both asset-based and URI-based outputs, including data URIs.
 *
 * @param output - The raw media output reference from the provider.
 * @returns A result containing the normalized binary port value or an execution error.
 */
export function normalizeImageOutput(
  output: IMediaOutputRef,
): TResult<IPortBinaryValue, IDagError> {
  if (output.kind === 'asset') {
    return normalizeAssetOutput(output);
  }
  return normalizeUriOutput(output);
}

function normalizeAssetOutput(output: IMediaOutputRef): TResult<IPortBinaryValue, IDagError> {
  if (typeof output.assetId !== 'string' || output.assetId.trim().length === 0) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_ASSET_INVALID',
        'Provider returned asset output without valid assetId',
        false,
      ),
    };
  }
  const mimeType =
    typeof output.mimeType === 'string' && output.mimeType.trim().length > 0 ? output.mimeType : '';
  if (!mimeType.startsWith('image/')) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID',
        'Provider returned non-image media type for Gemini output',
        false,
        { mimeType },
      ),
    };
  }
  return {
    ok: true,
    value: {
      kind: 'image',
      mimeType,
      uri: `asset://${output.assetId}`,
      referenceType: 'asset',
      assetId: output.assetId,
      sizeBytes: output.bytes,
    },
  };
}

function normalizeUriOutput(output: IMediaOutputRef): TResult<IPortBinaryValue, IDagError> {
  if (typeof output.uri !== 'string' || output.uri.trim().length === 0) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING',
        'Provider returned uri output without uri value',
        false,
      ),
    };
  }
  const outputMimeType =
    typeof output.mimeType === 'string' && output.mimeType.trim().length > 0 ? output.mimeType : '';
  if (output.uri.startsWith('data:')) {
    return normalizeDataUriOutput(output);
  }
  if (!outputMimeType.startsWith('image/')) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID',
        'Provider returned non-image URI output for Gemini runtime',
        false,
        { mimeType: outputMimeType },
      ),
    };
  }
  return {
    ok: true,
    value: {
      kind: 'image',
      mimeType: outputMimeType,
      uri: output.uri,
      referenceType: 'uri',
      sizeBytes: output.bytes,
    },
  };
}

function normalizeDataUriOutput(output: IMediaOutputRef): TResult<IPortBinaryValue, IDagError> {
  const parsedDataUri = parseDataUri(output.uri as string);
  if (!parsedDataUri || !parsedDataUri.mimeType.startsWith('image/')) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED',
        'Provider URI output must be image data URI',
        false,
      ),
    };
  }
  return {
    ok: true,
    value: {
      kind: 'image',
      mimeType: parsedDataUri.mimeType,
      uri: output.uri as string,
      referenceType: 'uri',
    },
  };
}

function parseDataUri(uri: string): { mimeType: string; data: string } | undefined {
  const commaIndex = uri.indexOf(',');
  if (commaIndex < 0) {
    return undefined;
  }
  const header = uri.slice(0, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  if (!header.startsWith('data:') || !header.endsWith(';base64')) {
    return undefined;
  }
  const mimeType = header.replace('data:', '').replace(';base64', '').trim();
  if (mimeType.length === 0 || payload.trim().length === 0) {
    return undefined;
  }
  return { mimeType, data: payload };
}
