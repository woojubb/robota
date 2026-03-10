import { describe, expect, it, vi } from 'vitest';
import { AssetAwareTaskExecutorPort } from '../asset-aware-task-executor.js';
import type { ITaskExecutorPort, ITaskExecutionInput, TTaskExecutionResult } from '@robota-sdk/dag-core';
import type { IAssetStore, IStoredAssetMetadata } from '../asset-store-contract.js';

function createMockDelegate(): ITaskExecutorPort {
    return {
        execute: vi.fn()
    };
}

function createMockAssetStore(): IAssetStore {
    return {
        save: vi.fn(),
        saveReference: vi.fn(),
        getMetadata: vi.fn(),
        getContent: vi.fn()
    };
}

function createSampleInput(): ITaskExecutionInput {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeId: 'node-1',
        attempt: 1,
        executionPath: [],
        input: { key: 'value' }
    };
}

function createSampleMetadata(assetId: string): IStoredAssetMetadata {
    return {
        assetId,
        fileName: 'test.png',
        mediaType: 'image/png',
        sizeBytes: 1024,
        createdAt: '2026-01-01T00:00:00.000Z'
    };
}

describe('AssetAwareTaskExecutorPort', () => {
    it('delegates execution and passes through non-binary output values', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { message: 'hello' },
            estimatedCostUsd: 0.01,
            totalCostUsd: 0.02
        };
        (delegate.execute as any).mockResolvedValue(successResult);

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output).toEqual({ message: 'hello' });
            expect(result.estimatedCostUsd).toBe(0.01);
            expect(result.totalCostUsd).toBe(0.02);
        }
    });

    it('passes through error results from delegate', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const errorResult: TTaskExecutionResult = {
            ok: false,
            error: { code: 'EXEC_FAILED', message: 'failed', category: 'task_execution', retryable: false }
        };
        (delegate.execute as any).mockResolvedValue(errorResult);

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(false);
        expect(assetStore.saveReference).not.toHaveBeenCalled();
    });

    it('converts binary output values to asset references via saveReference', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const binaryOutput = {
            kind: 'image' as const,
            mimeType: 'image/png',
            uri: 'https://example.com/image.png'
        };
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { image: binaryOutput },
            estimatedCostUsd: 0.01,
            totalCostUsd: 0.02
        };
        (delegate.execute as any).mockResolvedValue(successResult);
        (assetStore.saveReference as any).mockResolvedValue(createSampleMetadata('asset-123'));

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output.image).toEqual(expect.objectContaining({
                uri: 'asset://asset-123',
                referenceType: 'asset',
                assetId: 'asset-123'
            }));
        }
        expect(assetStore.saveReference).toHaveBeenCalledWith({
            fileName: 'image.image',
            mediaType: 'image/png',
            sourceUri: 'https://example.com/image.png',
            binaryKind: 'image',
            sizeBytes: undefined
        });
    });

    it('preserves existing asset:// references without calling saveReference', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const binaryOutput = {
            kind: 'image' as const,
            mimeType: 'image/png',
            uri: 'asset://existing-asset-id'
        };
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { image: binaryOutput },
            estimatedCostUsd: 0.01,
            totalCostUsd: 0.02
        };
        (delegate.execute as any).mockResolvedValue(successResult);

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output.image).toEqual(expect.objectContaining({
                uri: 'asset://existing-asset-id',
                referenceType: 'asset',
                assetId: 'existing-asset-id'
            }));
        }
        expect(assetStore.saveReference).not.toHaveBeenCalled();
    });

    it('handles video binary kind', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const binaryOutput = {
            kind: 'video' as const,
            mimeType: 'video/mp4',
            uri: 'https://example.com/video.mp4',
            sizeBytes: 2048
        };
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { video: binaryOutput },
            estimatedCostUsd: 0,
            totalCostUsd: 0
        };
        (delegate.execute as any).mockResolvedValue(successResult);
        (assetStore.saveReference as any).mockResolvedValue(createSampleMetadata('asset-video'));

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        expect(assetStore.saveReference).toHaveBeenCalledWith(
            expect.objectContaining({
                binaryKind: 'video',
                sizeBytes: 2048
            })
        );
    });

    it('handles audio binary kind', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const binaryOutput = {
            kind: 'audio' as const,
            mimeType: 'audio/mpeg',
            uri: 'https://example.com/audio.mp3'
        };
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { audio: binaryOutput },
            estimatedCostUsd: 0,
            totalCostUsd: 0
        };
        (delegate.execute as any).mockResolvedValue(successResult);
        (assetStore.saveReference as any).mockResolvedValue(createSampleMetadata('asset-audio'));

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
    });

    it('handles file binary kind', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const binaryOutput = {
            kind: 'file' as const,
            mimeType: 'application/pdf',
            uri: 'https://example.com/doc.pdf'
        };
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { doc: binaryOutput },
            estimatedCostUsd: 0,
            totalCostUsd: 0
        };
        (delegate.execute as any).mockResolvedValue(successResult);
        (assetStore.saveReference as any).mockResolvedValue(createSampleMetadata('asset-file'));

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
    });

    it('does not treat non-binary objects as binary values', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: {
                config: { key: 'value' },
                count: 42,
                flag: true
            },
            estimatedCostUsd: 0,
            totalCostUsd: 0
        };
        (delegate.execute as any).mockResolvedValue(successResult);

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output.config).toEqual({ key: 'value' });
            expect(result.output.count).toBe(42);
            expect(result.output.flag).toBe(true);
        }
        expect(assetStore.saveReference).not.toHaveBeenCalled();
    });

    it('does not treat null values as binary', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { empty: null as any },
            estimatedCostUsd: 0,
            totalCostUsd: 0
        };
        (delegate.execute as any).mockResolvedValue(successResult);

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        expect(assetStore.saveReference).not.toHaveBeenCalled();
    });

    it('handles empty asset:// URI gracefully (no asset ID)', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        // asset:// with empty string after prefix
        const binaryOutput = {
            kind: 'image' as const,
            mimeType: 'image/png',
            uri: 'asset://'
        };
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: { image: binaryOutput },
            estimatedCostUsd: 0,
            totalCostUsd: 0
        };
        (delegate.execute as any).mockResolvedValue(successResult);
        (assetStore.saveReference as any).mockResolvedValue(createSampleMetadata('new-asset'));

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        // Since parseAssetIdFromUri returns undefined for empty asset IDs,
        // it should fall through to saveReference
        expect(assetStore.saveReference).toHaveBeenCalled();
    });

    it('handles mixed binary and non-binary outputs', async () => {
        const delegate = createMockDelegate();
        const assetStore = createMockAssetStore();
        const successResult: TTaskExecutionResult = {
            ok: true,
            output: {
                message: 'hello',
                image: {
                    kind: 'image' as const,
                    mimeType: 'image/png',
                    uri: 'https://example.com/img.png'
                }
            },
            estimatedCostUsd: 0,
            totalCostUsd: 0
        };
        (delegate.execute as any).mockResolvedValue(successResult);
        (assetStore.saveReference as any).mockResolvedValue(createSampleMetadata('asset-mix'));

        const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
        const result = await executor.execute(createSampleInput());

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output.message).toBe('hello');
            expect((result.output.image as any).assetId).toBe('asset-mix');
        }
    });
});
