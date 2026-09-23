import { MediaReference } from './media-reference.js';

import type { IPortBinaryValue, TBinaryKind } from '@robota-sdk/dag-core';

/**
 * Provider-neutral normalization of a provider's media OUTPUT into a binary port value (#2168).
 *
 * Every media DAG node receives the same shape back from its provider — an asset id or a URI, an
 * optional MIME type, an optional byte count — and projects it onto `IPortBinaryValue` the same way.
 * Before this existed, three node packages each carried a copy of that projection, differing only in
 * the node's kind/MIME policy and its error codes. The projection lives here, next to
 * {@link MediaReference}; the policy is an argument; the error DECORATION (DAG error code, message)
 * stays in the leaf, which is why this returns a rejection reason rather than an `IDagError`.
 */

/** Structural view of a provider output reference; `IMediaOutputRef` (agent-core) satisfies it. */
export interface IProviderMediaOutputCandidate {
  kind: 'asset' | 'uri';
  assetId?: string;
  uri?: string;
  mimeType?: string;
  bytes?: number;
}

export interface IProviderMediaOutputPolicy {
  /** The binary kind of the port value this node produces. */
  kind: TBinaryKind;
  /** The MIME family the provider must return, e.g. `image/`, `video/`. */
  mediaTypePrefix: string;
  /**
   * Substituted when the provider returns no MIME type at all. Absent, a missing MIME type is a
   * `media_type_invalid` rejection. A present-but-wrong-family MIME type is always rejected.
   */
  defaultMimeType?: string;
  /**
   * When true, a `data:` URI is parsed: its MIME type must be base64-encoded and in the policy's
   * family, and it is projected without `sizeBytes`. When false, a `data:` URI is treated as any
   * other URI.
   */
  parseDataUri: boolean;
}

export type TProviderMediaOutputRejection =
  | { reason: 'asset_invalid' }
  | { reason: 'uri_missing' }
  | { reason: 'media_type_invalid'; mimeType: string | undefined }
  | { reason: 'data_uri_unsupported' };

export type TProviderMediaOutputResult =
  { ok: true; value: IPortBinaryValue } | { ok: false; rejection: TProviderMediaOutputRejection };

export function normalizeProviderMediaOutput(
  output: IProviderMediaOutputCandidate,
  policy: IProviderMediaOutputPolicy,
): TProviderMediaOutputResult {
  if (output.kind === 'asset') {
    if (typeof output.assetId !== 'string' || output.assetId.trim().length === 0) {
      return { ok: false, rejection: { reason: 'asset_invalid' } };
    }
    const mimeType = resolveMimeType(output.mimeType, policy);
    if (mimeType === undefined) {
      return { ok: false, rejection: { reason: 'media_type_invalid', mimeType: output.mimeType } };
    }
    return project(
      MediaReference.fromCandidate({
        assetId: output.assetId,
        mediaType: mimeType,
        sizeBytes: output.bytes,
      }),
      policy.kind,
      mimeType,
    );
  }
  if (typeof output.uri !== 'string' || output.uri.trim().length === 0) {
    return { ok: false, rejection: { reason: 'uri_missing' } };
  }
  if (policy.parseDataUri && output.uri.startsWith('data:')) {
    const parsed = parseDataUri(output.uri);
    if (parsed === undefined || !parsed.startsWith(policy.mediaTypePrefix)) {
      return { ok: false, rejection: { reason: 'data_uri_unsupported' } };
    }
    return project(
      MediaReference.fromCandidate({ uri: output.uri, mediaType: parsed }),
      policy.kind,
      parsed,
    );
  }
  const mimeType = resolveMimeType(output.mimeType, policy);
  if (mimeType === undefined) {
    return { ok: false, rejection: { reason: 'media_type_invalid', mimeType: output.mimeType } };
  }
  return project(
    MediaReference.fromCandidate({ uri: output.uri, mediaType: mimeType, sizeBytes: output.bytes }),
    policy.kind,
    mimeType,
  );
}

function resolveMimeType(
  rawMimeType: string | undefined,
  policy: IProviderMediaOutputPolicy,
): string | undefined {
  const present = typeof rawMimeType === 'string' && rawMimeType.trim().length > 0;
  if (!present) return policy.defaultMimeType;
  return rawMimeType.startsWith(policy.mediaTypePrefix) ? rawMimeType : undefined;
}

function project(
  reference: ReturnType<typeof MediaReference.fromCandidate>,
  kind: TBinaryKind,
  mimeType: string,
): TProviderMediaOutputResult {
  // `fromCandidate` only fails on an empty id/uri, which the guards above have already refused; a
  // failure here is therefore the asset branch's own precondition, reported under that reason.
  if (!reference.ok) return { ok: false, rejection: { reason: 'asset_invalid' } };
  return { ok: true, value: reference.value.toBinary(kind, mimeType) };
}

/** Returns the MIME type of a base64 `data:` URI, or `undefined` when it is not one. */
function parseDataUri(uri: string): string | undefined {
  const commaIndex = uri.indexOf(',');
  if (commaIndex < 0) return undefined;
  const header = uri.slice(0, commaIndex);
  const payload = uri.slice(commaIndex + 1);
  if (!header.startsWith('data:') || !header.endsWith(';base64')) return undefined;
  const mimeType = header.replace('data:', '').replace(';base64', '').trim();
  if (mimeType.length === 0 || payload.trim().length === 0) return undefined;
  return mimeType;
}
