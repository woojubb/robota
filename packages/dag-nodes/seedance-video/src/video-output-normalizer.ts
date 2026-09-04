import {
  normalizeProviderMediaOutput,
  type TProviderMediaOutputRejection,
} from '@robota-sdk/dag-node';
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
 * The projection is the provider-neutral `normalizeProviderMediaOutput` (#2168); this leaf owns the
 * video policy and the Seedance error decoration. Unlike the image nodes, the policy is lenient about
 * the mime type: the ByteDance provider often returns a plain URL with no mime type, so a
 * missing/blank mime type defaults to `video/mp4`. A present-but-non-video mime type is still rejected.
 */
export function normalizeVideoOutput(
  output: IMediaOutputRef,
): TResult<IPortBinaryValue, IDagError> {
  const result = normalizeProviderMediaOutput(output, {
    kind: 'video',
    mediaTypePrefix: 'video/',
    defaultMimeType: DEFAULT_VIDEO_MIME_TYPE,
    parseDataUri: false,
  });
  if (result.ok) return result;
  return { ok: false, error: decorate(result.rejection) };
}

function decorate(rejection: TProviderMediaOutputRejection): IDagError {
  switch (rejection.reason) {
    case 'asset_invalid':
      return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_ASSET_INVALID',
        'Provider returned asset output without valid assetId',
        false,
      );
    case 'uri_missing':
      return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_URI_MISSING',
        'Provider returned uri output without uri value',
        false,
      );
    case 'media_type_invalid':
    case 'data_uri_unsupported':
      return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_MEDIA_TYPE_INVALID',
        'Provider returned non-video media type for seedance-video output',
        false,
        {
          mimeType:
            rejection.reason === 'media_type_invalid'
              ? (rejection.mimeType ?? 'missing')
              : 'missing',
        },
      );
  }
}
