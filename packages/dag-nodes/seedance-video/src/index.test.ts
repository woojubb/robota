import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { INodeExecutionContext, IPortBinaryValue } from '@robota-sdk/dag-core';
import { SeedanceVideoNodeDefinition } from './index.js';

// Mock the runtime module
const mockGenerateVideo = vi.fn();
vi.mock('./runtime.js', () => ({
    SeedanceVideoRuntime: vi.fn(() => ({
        generateVideo: mockGenerateVideo
    }))
}));

function createContext(config: Record<string, string | number | boolean> = {}): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'seedance-1',
            nodeType: 'seedance-video',
            dependsOn: [],
            inputs: [
                { key: 'prompt', type: 'string', required: true },
                { key: 'images', type: 'binary', required: false }
            ],
            outputs: [
                { key: 'video', type: 'binary', required: true }
            ],
            config
        },
        nodeManifest: {
            nodeType: 'seedance-video',
            displayName: 'Seedance Video',
            category: 'AI',
            inputs: [],
            outputs: []
        },
        attempt: 1,
        executionPath: [],
        currentTotalCredits: 0
    };
}

describe('SeedanceVideoNodeDefinition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('metadata', () => {
        it('has correct nodeType, displayName, and category', () => {
            const node = new SeedanceVideoNodeDefinition();
            expect(node.nodeType).toBe('seedance-video');
            expect(node.displayName).toBe('Seedance Video');
            expect(node.category).toBe('AI');
        });

        it('has prompt and images input ports', () => {
            const node = new SeedanceVideoNodeDefinition();
            expect(node.inputs).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: 'prompt', type: 'string', required: true }),
                    expect.objectContaining({ key: 'images', required: false })
                ])
            );
        });

        it('has video output port', () => {
            const node = new SeedanceVideoNodeDefinition();
            expect(node.outputs).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: 'video', required: true })
                ])
            );
        });
    });

    describe('estimateCost', () => {
        it('returns base cost when no images provided', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const result = await node.taskHandler.estimateCost!({ prompt: 'test' }, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.estimatedCredits).toBe(0.08);
            }
        });

        it('adds surcharge when images are provided', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const images: IPortBinaryValue[] = [
                { kind: 'image', mimeType: 'image/png', uri: 'asset://img-1' }
            ];
            const result = await node.taskHandler.estimateCost!({ prompt: 'test', images }, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.estimatedCredits).toBe(0.10);
            }
        });

        it('uses custom baseCredits from config', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext({ baseCredits: 0.20 });
            const result = await node.taskHandler.estimateCost!({ prompt: 'test' }, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.estimatedCredits).toBe(0.20);
            }
        });

        it('returns validation error for invalid config schema', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext({ pollIntervalMs: -1 });
            const result = await node.taskHandler.estimateCost!({ prompt: 'test' }, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_NODE_CONFIG_SCHEMA_INVALID');
            }
        });
    });

    describe('execute', () => {
        it('returns error when prompt is missing', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const result = await node.taskHandler.execute({}, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED');
            }
        });

        it('returns error when prompt is empty string', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const result = await node.taskHandler.execute({ prompt: '' }, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED');
            }
        });

        it('returns error when prompt is whitespace only', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const result = await node.taskHandler.execute({ prompt: '   ' }, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED');
            }
        });

        it('returns error when images input is invalid binary list', async () => {
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            // Provide images that are not a valid binary list (string instead of array)
            const result = await node.taskHandler.execute({ prompt: 'test prompt', images: 'not-an-array' }, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_IMAGES_INVALID');
            }
        });

        it('calls runtime.generateVideo with correct parameters', async () => {
            mockGenerateVideo.mockResolvedValue({
                ok: true,
                value: { kind: 'video', mimeType: 'video/mp4', uri: 'https://cdn.example.com/video.mp4' }
            });
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext({
                model: 'seedance-custom',
                durationSeconds: 10,
                aspectRatio: '16:9',
                seed: 42
            });
            const result = await node.taskHandler.execute({ prompt: 'test prompt' }, context);
            expect(result.ok).toBe(true);
            expect(mockGenerateVideo).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: 'test prompt',
                    model: 'seedance-custom',
                    durationSeconds: 10,
                    aspectRatio: '16:9',
                    seed: 42
                })
            );
        });

        it('sets video output on success', async () => {
            const videoOutput: IPortBinaryValue = {
                kind: 'video',
                mimeType: 'video/mp4',
                uri: 'https://cdn.example.com/video.mp4'
            };
            mockGenerateVideo.mockResolvedValue({
                ok: true,
                value: videoOutput
            });
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const result = await node.taskHandler.execute({ prompt: 'test prompt' }, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.video).toEqual(videoOutput);
            }
        });

        it('returns error when runtime returns non-video output', async () => {
            mockGenerateVideo.mockResolvedValue({
                ok: true,
                value: { kind: 'image', mimeType: 'image/png', uri: 'https://cdn.example.com/image.png' }
            });
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const result = await node.taskHandler.execute({ prompt: 'test prompt' }, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_INVALID');
            }
        });

        it('propagates runtime error', async () => {
            mockGenerateVideo.mockResolvedValue({
                ok: false,
                error: {
                    code: 'DAG_TASK_EXECUTION_SEEDANCE_CREATE_FAILED',
                    message: 'Provider call failed',
                    layer: 'execution',
                    retryable: false
                }
            });
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            const result = await node.taskHandler.execute({ prompt: 'test prompt' }, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_CREATE_FAILED');
            }
        });

        it('uses default model when config model is empty', async () => {
            mockGenerateVideo.mockResolvedValue({
                ok: true,
                value: { kind: 'video', mimeType: 'video/mp4', uri: 'https://cdn.example.com/video.mp4' }
            });
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext({ model: '   ' });
            await node.taskHandler.execute({ prompt: 'test prompt' }, context);
            expect(mockGenerateVideo).toHaveBeenCalledWith(
                expect.objectContaining({ model: 'seedance-1-5-pro-251215' })
            );
        });

        it('trims and omits empty aspectRatio', async () => {
            mockGenerateVideo.mockResolvedValue({
                ok: true,
                value: { kind: 'video', mimeType: 'video/mp4', uri: 'https://cdn.example.com/video.mp4' }
            });
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext({ aspectRatio: '  ' });
            await node.taskHandler.execute({ prompt: 'test prompt' }, context);
            expect(mockGenerateVideo).toHaveBeenCalledWith(
                expect.objectContaining({ aspectRatio: undefined })
            );
        });

        it('passes valid images to runtime', async () => {
            mockGenerateVideo.mockResolvedValue({
                ok: true,
                value: { kind: 'video', mimeType: 'video/mp4', uri: 'https://cdn.example.com/video.mp4' }
            });
            const images: IPortBinaryValue[] = [
                { kind: 'image', mimeType: 'image/png', uri: 'asset://img-1', referenceType: 'asset', assetId: 'img-1' }
            ];
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            await node.taskHandler.execute({ prompt: 'test prompt', images }, context);
            expect(mockGenerateVideo).toHaveBeenCalledWith(
                expect.objectContaining({ inputImages: images })
            );
        });

        it('skips images when undefined', async () => {
            mockGenerateVideo.mockResolvedValue({
                ok: true,
                value: { kind: 'video', mimeType: 'video/mp4', uri: 'https://cdn.example.com/video.mp4' }
            });
            const node = new SeedanceVideoNodeDefinition();
            const context = createContext();
            await node.taskHandler.execute({ prompt: 'test prompt' }, context);
            expect(mockGenerateVideo).toHaveBeenCalledWith(
                expect.objectContaining({ inputImages: undefined })
            );
        });
    });

    describe('constructor options', () => {
        it('accepts optional runtime options', () => {
            const node = new SeedanceVideoNodeDefinition({
                apiKey: 'test-key',
                baseUrl: 'https://api.example.com',
                defaultModel: 'custom-model',
                allowedModels: ['custom-model']
            });
            expect(node).toBeDefined();
        });

        it('works without options', () => {
            const node = new SeedanceVideoNodeDefinition();
            expect(node).toBeDefined();
        });
    });
});
