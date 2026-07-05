import {
  buildTaskExecutionError,
  type IDagError,
  type IPortBinaryValue,
  type TResult,
} from '@robota-sdk/dag-core';
import type { IMediaOutputRef } from '@robota-sdk/agent-core';

const DEFAULT_VIDEO_MIME_TYPE = 'video/mp4';

/**
 * Normalizes a provider media output reference into a video binary port value.
 *
 * Unlike the image normalizer, this is lenient about the mime type: the ByteDance
 * provider often returns a plain URL with no mime type, so a missing/blank mime type
 * defaults to `video/mp4`. A present-but-non-video mime type is still rejected.
 */
export function normalizeVideoOutput(
  output: IMediaOutputRef,
): TResult<IPortBinaryValue, IDagError> {
  if (output.kind === 'asset') {
    return normalizeAssetOutput(output);
  }
  return normalizeUriOutput(output);
}

function resolveVideoMimeType(rawMimeType: string | undefined): string | undefined {
  if (typeof rawMimeType !== 'string' || rawMimeType.trim().length === 0) {
    return DEFAULT_VIDEO_MIME_TYPE;
  }
  if (!rawMimeType.startsWith('video/')) {
    return undefined;
  }
  return rawMimeType;
}

function normalizeAssetOutput(output: IMediaOutputRef): TResult<IPortBinaryValue, IDagError> {
  if (typeof output.assetId !== 'string' || output.assetId.trim().length === 0) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_ASSET_INVALID',
        'Provider returned asset output without valid assetId',
        false,
      ),
    };
  }
  const mimeType = resolveVideoMimeType(output.mimeType);
  if (mimeType === undefined) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_MEDIA_TYPE_INVALID',
        'Provider returned non-video media type for seedance-video output',
        false,
        { mimeType: output.mimeType ?? 'missing' },
      ),
    };
  }
  return {
    ok: true,
    value: {
      kind: 'video',
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
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_URI_MISSING',
        'Provider returned uri output without uri value',
        false,
      ),
    };
  }
  const mimeType = resolveVideoMimeType(output.mimeType);
  if (mimeType === undefined) {
    return {
      ok: false,
      error: buildTaskExecutionError(
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_MEDIA_TYPE_INVALID',
        'Provider returned non-video media type for seedance-video output',
        false,
        { mimeType: output.mimeType ?? 'missing' },
      ),
    };
  }
  return {
    ok: true,
    value: {
      kind: 'video',
      mimeType,
      uri: output.uri,
      referenceType: 'uri',
      sizeBytes: output.bytes,
    },
  };
}
