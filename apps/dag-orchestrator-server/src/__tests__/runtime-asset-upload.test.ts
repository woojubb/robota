import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type {
  IAssetContentResult,
  IAssetStore,
  ICreateAssetInput,
  ICreateAssetReferenceInput,
  IPromptRequest,
  IStoredAssetMetadata,
} from '@robota-sdk/dag-core';
import { resolvePromptAssetsForRuntime } from '../routes/runtime-asset-upload.js';

class RuntimeMappedAssetStore implements IAssetStore {
  public contentReadCount = 0;

  public async save(_input: ICreateAssetInput): Promise<IStoredAssetMetadata> {
    throw new Error('save is not used by runtime asset resolution');
  }

  public async saveReference(_input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata> {
    throw new Error('saveReference is not used by runtime asset resolution');
  }

  public async getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined> {
    return {
      assetId,
      fileName: 'photo.png',
      mediaType: 'image/png',
      sizeBytes: 4,
      createdAt: '2026-05-05T00:00:00.000Z',
      runtimeAssetId: 'runtime-asset-1',
    };
  }

  public async getContent(assetId: string): Promise<IAssetContentResult | undefined> {
    this.contentReadCount += 1;
    return {
      stream: Readable.from([new Uint8Array([1, 2, 3, 4])]),
      metadata: {
        assetId,
        fileName: 'photo.png',
        mediaType: 'image/png',
        sizeBytes: 4,
        createdAt: '2026-05-05T00:00:00.000Z',
        runtimeAssetId: 'runtime-asset-1',
      },
    };
  }
}

describe('resolvePromptAssetsForRuntime', () => {
  it('rewrites prompt asset references with stored runtimeAssetId without re-reading content', async () => {
    const assetStore = new RuntimeMappedAssetStore();
    const promptRequest: IPromptRequest = {
      prompt: {
        '1': {
          class_type: 'image-loader',
          inputs: {
            asset: { referenceType: 'asset', assetId: 'local-asset-1' },
          },
        },
      },
    };

    const result = await resolvePromptAssetsForRuntime(
      promptRequest,
      assetStore,
      'http://127.0.0.1:1',
    );

    expect(result.ok).toBe(true);
    expect(assetStore.contentReadCount).toBe(0);
    const assetInput = promptRequest.prompt['1'].inputs.asset as { assetId: string };
    expect(assetInput.assetId).toBe('runtime-asset-1');
  });
});
