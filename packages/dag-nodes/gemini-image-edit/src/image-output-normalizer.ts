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

/**
 * Normalizes a provider media output reference into a standard image binary port value.
 *
 * The projection is the provider-neutral `normalizeProviderMediaOutput` (#2168); this leaf owns only
 * the image policy and the Gemini error decoration.
 */
export function normalizeImageOutput(
  output: IMediaOutputRef,
): TResult<IPortBinaryValue, IDagError> {
  const result = normalizeProviderMediaOutput(output, {
    kind: 'image',
    mediaTypePrefix: 'image/',
    parseDataUri: true,
  });
  if (result.ok) return result;
  return { ok: false, error: decorate(result.rejection, output) };
}

function decorate(rejection: TProviderMediaOutputRejection, output: IMediaOutputRef): IDagError {
  switch (rejection.reason) {
    case 'asset_invalid':
      return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_ASSET_INVALID',
        'Provider returned asset output without valid assetId',
        false,
      );
    case 'uri_missing':
      return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING',
        'Provider returned uri output without uri value',
        false,
      );
    case 'media_type_invalid':
      return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID',
        output.kind === 'asset'
          ? 'Provider returned non-image media type for Gemini output'
          : 'Provider returned non-image URI output for Gemini runtime',
        false,
        { mimeType: rejection.mimeType?.trim() ? rejection.mimeType : '' },
      );
    case 'data_uri_unsupported':
      return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED',
        'Provider URI output must be image data URI',
        false,
      );
  }
}
