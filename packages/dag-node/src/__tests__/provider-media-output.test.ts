import { describe, expect, it } from 'vitest';

import {
  normalizeProviderMediaOutput,
  type IProviderMediaOutputPolicy,
} from '../value-objects/provider-media-output.js';

/**
 * Characterization of the projection the three media nodes previously each carried (#2168): the
 * image policy is what gemini-image-edit and text-to-image did, the video policy is what
 * seedance-video did. Behaviour here is what the leaves depended on, pinned before their copies
 * were deleted.
 */
const IMAGE: IProviderMediaOutputPolicy = {
  kind: 'image',
  mediaTypePrefix: 'image/',
  parseDataUri: true,
};
const VIDEO: IProviderMediaOutputPolicy = {
  kind: 'video',
  mediaTypePrefix: 'video/',
  defaultMimeType: 'video/mp4',
  parseDataUri: false,
};

describe('normalizeProviderMediaOutput — image policy', () => {
  it('projects an asset output onto an asset:// binary with size', () => {
    const result = normalizeProviderMediaOutput(
      { kind: 'asset', assetId: 'abc-123', mimeType: 'image/png', bytes: 1024 },
      IMAGE,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'image',
        mimeType: 'image/png',
        uri: 'asset://abc-123',
        referenceType: 'asset',
        assetId: 'abc-123',
        sizeBytes: 1024,
      },
    });
  });

  it('rejects an asset output with a missing or blank assetId', () => {
    expect(normalizeProviderMediaOutput({ kind: 'asset', assetId: '  ' }, IMAGE)).toEqual({
      ok: false,
      rejection: { reason: 'asset_invalid' },
    });
  });

  it('rejects a missing MIME type when the policy has no default, reporting it as given', () => {
    expect(normalizeProviderMediaOutput({ kind: 'asset', assetId: 'a' }, IMAGE)).toEqual({
      ok: false,
      rejection: { reason: 'media_type_invalid', mimeType: undefined },
    });
    expect(
      normalizeProviderMediaOutput(
        { kind: 'uri', uri: 'https://x/y', mimeType: 'video/mp4' },
        IMAGE,
      ),
    ).toEqual({ ok: false, rejection: { reason: 'media_type_invalid', mimeType: 'video/mp4' } });
  });

  it('rejects a uri output without a uri', () => {
    expect(normalizeProviderMediaOutput({ kind: 'uri', uri: '' }, IMAGE)).toEqual({
      ok: false,
      rejection: { reason: 'uri_missing' },
    });
  });

  it('projects a plain uri output with its size', () => {
    const result = normalizeProviderMediaOutput(
      { kind: 'uri', uri: 'https://x/y.png', mimeType: 'image/png', bytes: 7 },
      IMAGE,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'image',
        mimeType: 'image/png',
        uri: 'https://x/y.png',
        referenceType: 'uri',
        sizeBytes: 7,
      },
    });
  });

  it('parses a base64 data uri, takes its MIME type, and carries no size', () => {
    const result = normalizeProviderMediaOutput(
      { kind: 'uri', uri: 'data:image/jpeg;base64,AAAA', mimeType: 'text/plain', bytes: 99 },
      IMAGE,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'image',
        mimeType: 'image/jpeg',
        uri: 'data:image/jpeg;base64,AAAA',
        referenceType: 'uri',
        sizeBytes: undefined,
      },
    });
  });

  it('rejects a data uri that is not base64, has no payload, or is not in the family', () => {
    for (const uri of [
      'data:image/png,AAAA',
      'data:image/png;base64,',
      'data:video/mp4;base64,AA',
    ]) {
      expect(normalizeProviderMediaOutput({ kind: 'uri', uri }, IMAGE)).toEqual({
        ok: false,
        rejection: { reason: 'data_uri_unsupported' },
      });
    }
  });
});

describe('normalizeProviderMediaOutput — video policy', () => {
  it('defaults a missing MIME type to the policy default on both branches', () => {
    expect(normalizeProviderMediaOutput({ kind: 'asset', assetId: 'v1' }, VIDEO)).toMatchObject({
      ok: true,
      value: { kind: 'video', mimeType: 'video/mp4', uri: 'asset://v1', assetId: 'v1' },
    });
    expect(
      normalizeProviderMediaOutput({ kind: 'uri', uri: 'https://x/v', mimeType: ' ' }, VIDEO),
    ).toMatchObject({
      ok: true,
      value: { kind: 'video', mimeType: 'video/mp4', uri: 'https://x/v', referenceType: 'uri' },
    });
  });

  it('still rejects a present MIME type outside the family', () => {
    expect(
      normalizeProviderMediaOutput(
        { kind: 'uri', uri: 'https://x/v', mimeType: 'image/png' },
        VIDEO,
      ),
    ).toEqual({ ok: false, rejection: { reason: 'media_type_invalid', mimeType: 'image/png' } });
  });

  it('does not parse data uris when the policy says not to', () => {
    expect(
      normalizeProviderMediaOutput({ kind: 'uri', uri: 'data:video/webm;base64,AA' }, VIDEO),
    ).toMatchObject({
      ok: true,
      value: { mimeType: 'video/mp4', uri: 'data:video/webm;base64,AA' },
    });
  });
});
