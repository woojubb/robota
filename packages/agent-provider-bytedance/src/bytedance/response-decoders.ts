/**
 * Endpoint response decoders (issue #2166): a 2xx body is `unknown` until each field the provider
 * reads has been checked. Before this, `requestJson` cast whatever parsed as JSON to the endpoint
 * DTO, so an empty object, an array or a wrong-typed field surfaced later as a `TypeError` outside
 * the provider's typed error channel. The provider owns its own `unknown → DTO |
 * PROVIDER_UPSTREAM_ERROR` decoding; no shared vendor decoder is involved.
 */
import type { IBytedanceCreateVideoTaskResponse, IBytedanceVideoTaskResponse } from './types';
import type { TProviderMediaResult } from '@robota-sdk/agent-core';

type TDecoded<T> = { ok: true; value: T } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function upstreamError(endpoint: string, message: string): TProviderMediaResult<never> {
  return {
    ok: false,
    error: {
      code: 'PROVIDER_UPSTREAM_ERROR',
      message: `Bytedance ${endpoint} response is malformed: ${message}`,
    },
  };
}

function requiredString(record: Record<string, unknown>, key: string): TDecoded<string> {
  const value = record[key];
  if (typeof value !== 'string') {
    return { ok: false, message: `\`${key}\` must be a string (got ${describeValue(value)})` };
  }
  return { ok: true, value };
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): TDecoded<string | undefined> {
  const value = record[key];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string') {
    return {
      ok: false,
      message: `\`${key}\` must be a string when present (got ${describeValue(value)})`,
    };
  }
  return { ok: true, value };
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
): TDecoded<number | undefined> {
  const value = record[key];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      message: `\`${key}\` must be a number when present (got ${describeValue(value)})`,
    };
  }
  return { ok: true, value };
}

function optionalTimestamp(
  record: Record<string, unknown>,
  key: string,
): TDecoded<string | number | undefined> {
  const value = record[key];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string' && typeof value !== 'number') {
    return {
      ok: false,
      message: `\`${key}\` must be a string or number when present (got ${describeValue(value)})`,
    };
  }
  return { ok: true, value };
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** `POST /contents/generations/tasks`: `id` is required; `status` and `created_at` are optional. */
export function decodeCreateVideoTaskResponse(
  value: unknown,
): TProviderMediaResult<IBytedanceCreateVideoTaskResponse> {
  const endpoint = 'createVideo';
  if (!isRecord(value))
    return upstreamError(endpoint, `body must be an object (got ${describeValue(value)})`);
  const id = requiredString(value, 'id');
  if (!id.ok) return upstreamError(endpoint, id.message);
  const status = optionalString(value, 'status');
  if (!status.ok) return upstreamError(endpoint, status.message);
  const createdAt = optionalTimestamp(value, 'created_at');
  if (!createdAt.ok) return upstreamError(endpoint, createdAt.message);
  return {
    ok: true,
    value: {
      id: id.value,
      ...(status.value !== undefined ? { status: status.value } : {}),
      ...(createdAt.value !== undefined ? { created_at: createdAt.value } : {}),
    },
  };
}

/** `GET`/`DELETE /contents/generations/tasks/{id}`: `id` and `status` are required. */
export function decodeVideoTaskResponse(
  endpoint: 'getVideoJob' | 'cancelVideoJob',
): (value: unknown) => TProviderMediaResult<IBytedanceVideoTaskResponse> {
  return (value) => {
    if (!isRecord(value))
      return upstreamError(endpoint, `body must be an object (got ${describeValue(value)})`);
    const id = requiredString(value, 'id');
    if (!id.ok) return upstreamError(endpoint, id.message);
    const status = requiredString(value, 'status');
    if (!status.ok) return upstreamError(endpoint, status.message);
    const videoUrl = optionalString(value, 'video_url');
    if (!videoUrl.ok) return upstreamError(endpoint, videoUrl.message);
    const mimeType = optionalString(value, 'mime_type');
    if (!mimeType.ok) return upstreamError(endpoint, mimeType.message);
    const bytes = optionalNumber(value, 'bytes');
    if (!bytes.ok) return upstreamError(endpoint, bytes.message);
    const errorMessage = optionalString(value, 'error_message');
    if (!errorMessage.ok) return upstreamError(endpoint, errorMessage.message);
    const createdAt = optionalTimestamp(value, 'created_at');
    if (!createdAt.ok) return upstreamError(endpoint, createdAt.message);
    const updatedAt = optionalTimestamp(value, 'updated_at');
    if (!updatedAt.ok) return upstreamError(endpoint, updatedAt.message);

    let content: IBytedanceVideoTaskResponse['content'];
    if (value.content !== undefined && value.content !== null) {
      if (!isRecord(value.content)) {
        return upstreamError(
          endpoint,
          `\`content\` must be an object when present (got ${describeValue(value.content)})`,
        );
      }
      const contentUrl = optionalString(value.content, 'video_url');
      if (!contentUrl.ok) return upstreamError(endpoint, `content.${contentUrl.message}`);
      content = contentUrl.value !== undefined ? { video_url: contentUrl.value } : {};
    }

    return {
      ok: true,
      value: {
        id: id.value,
        status: status.value,
        ...(videoUrl.value !== undefined ? { video_url: videoUrl.value } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(mimeType.value !== undefined ? { mime_type: mimeType.value } : {}),
        ...(bytes.value !== undefined ? { bytes: bytes.value } : {}),
        ...(errorMessage.value !== undefined ? { error_message: errorMessage.value } : {}),
        ...(createdAt.value !== undefined ? { created_at: createdAt.value } : {}),
        ...(updatedAt.value !== undefined ? { updated_at: updatedAt.value } : {}),
      },
    };
  };
}
