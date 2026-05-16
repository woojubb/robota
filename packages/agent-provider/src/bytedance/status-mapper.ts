import type { TProviderMediaResult, IVideoJobSnapshot } from '@robota-sdk/agent-core';
import type { IBytedanceVideoTaskResponse } from './types';

/** Threshold (in milliseconds) above which a numeric timestamp is treated as milliseconds rather than seconds. */
const MILLISECOND_EPOCH_THRESHOLD = 1_000_000_000_000;

/** Conversion factor from seconds to milliseconds. */
const MS_PER_SECOND = 1000;

/** Maps a Bytedance video task response into a normalized job snapshot. */
export function mapVideoJobSnapshot(
  response: IBytedanceVideoTaskResponse,
): TProviderMediaResult<IVideoJobSnapshot> {
  if (response.id.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_UPSTREAM_ERROR',
        message: 'Bytedance video job response is missing task id.',
      },
    };
  }
  const normalizedStatusResult = mapVideoStatus(response.status);
  if (!normalizedStatusResult.ok) {
    return normalizedStatusResult;
  }
  return {
    ok: true,
    value: {
      jobId: response.id,
      status: normalizedStatusResult.value,
      output: mapOutput(response),
      error:
        normalizedStatusResult.value === 'failed' && response.error_message
          ? { code: 'PROVIDER_UPSTREAM_ERROR', message: response.error_message }
          : undefined,
      updatedAt: toIsoTimestamp(response.updated_at ?? response.created_at),
    },
  };
}

/** Maps a Bytedance status string to a normalized video job status. */
export function mapVideoStatus(status: string): TProviderMediaResult<IVideoJobSnapshot['status']> {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'queued' || normalized === 'pending' || normalized === 'submitted') {
    return { ok: true, value: 'queued' };
  }
  if (normalized === 'running' || normalized === 'processing' || normalized === 'in_progress') {
    return { ok: true, value: 'running' };
  }
  if (normalized === 'succeeded' || normalized === 'success' || normalized === 'completed') {
    return { ok: true, value: 'succeeded' };
  }
  if (normalized === 'failed' || normalized === 'error') {
    return { ok: true, value: 'failed' };
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return { ok: true, value: 'cancelled' };
  }
  return {
    ok: false,
    error: {
      code: 'PROVIDER_UPSTREAM_ERROR',
      message: `Unexpected video job status from Bytedance: ${status}`,
    },
  };
}

/** Maps the initial createVideo status to queued or running. */
export function mapInitialStatus(
  statusValue: string | undefined,
): TProviderMediaResult<'queued' | 'running'> {
  if (typeof statusValue !== 'string' || statusValue.trim().length === 0) {
    return { ok: true, value: 'queued' };
  }
  const normalizedStatus = statusValue.trim().toLowerCase();
  if (
    normalizedStatus === 'queued' ||
    normalizedStatus === 'pending' ||
    normalizedStatus === 'submitted'
  ) {
    return { ok: true, value: 'queued' };
  }
  if (
    normalizedStatus === 'running' ||
    normalizedStatus === 'processing' ||
    normalizedStatus === 'in_progress'
  ) {
    return { ok: true, value: 'running' };
  }
  return {
    ok: false,
    error: {
      code: 'PROVIDER_UPSTREAM_ERROR',
      message: `Unexpected createVideo status from Bytedance: ${statusValue}`,
    },
  };
}

/** Converts a numeric or string timestamp to ISO 8601 format. */
export function toIsoTimestamp(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const numericTimestamp = value > MILLISECOND_EPOCH_THRESHOLD ? value : value * MS_PER_SECOND;
    const date = new Date(numericTimestamp);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const maybeNumeric = Number(value);
    if (Number.isFinite(maybeNumeric)) {
      return toIsoTimestamp(maybeNumeric);
    }
    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }
  return new Date().toISOString();
}

function mapOutput(response: IBytedanceVideoTaskResponse): IVideoJobSnapshot['output'] {
  const directVideoUrl =
    typeof response.video_url === 'string' && response.video_url.trim().length > 0
      ? response.video_url
      : undefined;
  const contentVideoUrl =
    typeof response.content?.video_url === 'string' && response.content.video_url.trim().length > 0
      ? response.content.video_url
      : undefined;
  const resolvedVideoUrl = directVideoUrl ?? contentVideoUrl;
  if (typeof resolvedVideoUrl !== 'string') {
    return undefined;
  }
  return {
    kind: 'uri',
    uri: resolvedVideoUrl,
    mimeType: response.mime_type,
    bytes: response.bytes,
  };
}
