import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IPortBinaryValue, INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

// Mock runtime-core to isolate node definitions from provider logic
vi.mock('./runtime-core.js', () => {
    const mockEditImage = vi.fn();
    const mockComposeImages = vi.fn();
    return {
        GeminiImageRuntime: vi.fn().mockImplementation(() => ({
            editImage: mockEditImage,
            composeImages: mockComposeImages
        })),
        isImageBinaryValue: vi.fn((value: Partial<IPortBinaryValue> | null | undefined) => {
            if (!value) return false;
            return value.kind === 'image' && typeof value.mimeType === 'string' && typeof value.uri === 'string';
        }),
        // Re-export mocks for test access
        __mockEditImage: mockEditImage,
        __mockComposeImages: mockComposeImages
    };
});

import { GeminiImageEditNodeDefinition, GeminiImageComposeNodeDefinition } from './index.js';
import { GeminiImageRuntime } from './runtime-core.js';

function getMockEditImage(): ReturnType<typeof vi.fn> {
    // Access the mock editImage from the constructed runtime
    const runtimeInstance = vi.mocked(GeminiImageRuntime).mock.results[
        vi.mocked(GeminiImageRuntime).mock.results.length - 1
    ]?.value as { editImage: ReturnType<typeof vi.fn> };
    return runtimeInstance.editImage;
}

function getMockComposeImages(): ReturnType<typeof vi.fn> {
    const runtimeInstance = vi.mocked(GeminiImageRuntime).mock.results[
        vi.mocked(GeminiImageRuntime).mock.results.length - 1
    ]?.value as { composeImages: ReturnType<typeof vi.fn> };
    return runtimeInstance.composeImages;
}

function makeImageBinary(overrides?: Partial<IPortBinaryValue>): IPortBinaryValue {
    return {
        kind: 'image',
        mimeType: 'image/png',
        uri: 'data:image/png;base64,iVBOR',
        ...overrides
    };
}

function makeExecutionContext(nodeId: string = 'node-1'): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId,
            nodeType: 'gemini-image-edit',
            dependsOn: [],
            config: {},
            inputs: [],
            outputs: []
        },
        nodeManifest: {
            nodeType: 'gemini-image-edit',
            displayName: 'Gemini Image Edit',
            category: 'AI',
            inputs: [],
            outputs: []
        },
        attempt: 1,
        executionPath: [],
        currentTotalCostUsd: 0
    };
}

// ---------------------------------------------------------------------------
// GeminiImageEditNodeDefinition
// ---------------------------------------------------------------------------
describe('GeminiImageEditNodeDefinition', () => {
    let node: GeminiImageEditNodeDefinition;

    beforeEach(() => {
        vi.clearAllMocks();
        node = new GeminiImageEditNodeDefinition();
    });

    describe('static properties', () => {
        it('has correct nodeType', () => {
            expect(node.nodeType).toBe('gemini-image-edit');
        });

        it('has correct displayName', () => {
            expect(node.displayName).toBe('Gemini Image Edit');
        });

        it('has correct category', () => {
            expect(node.category).toBe('AI');
        });

        it('has image input port', () => {
            const imageInput = node.inputs.find((p) => p.key === 'image');
            expect(imageInput).toBeDefined();
            expect(imageInput?.required).toBe(true);
        });

        it('has prompt input port', () => {
            const promptInput = node.inputs.find((p) => p.key === 'prompt');
            expect(promptInput).toBeDefined();
            expect(promptInput?.required).toBe(true);
            expect(promptInput?.type).toBe('string');
        });

        it('has image output port', () => {
            const imageOutput = node.outputs.find((p) => p.key === 'image');
            expect(imageOutput).toBeDefined();
        });
    });

    describe('estimateCost', () => {
        it('returns default cost estimate via taskHandler', async () => {
            const context = makeExecutionContext();
            context.nodeDefinition.config = {};
            const result = await node.taskHandler.estimateCost!({}, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.estimatedCostUsd).toBe(0.01);
            }
        });

        it('returns custom cost from config', async () => {
            const context = makeExecutionContext();
            context.nodeDefinition.config = { baseCostUsd: 0.05 };
            const result = await node.taskHandler.estimateCost!({}, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.estimatedCostUsd).toBe(0.05);
            }
        });
    });

    describe('execute', () => {
        it('returns validation error when image input is missing', async () => {
            const context = makeExecutionContext();
            const input: TPortPayload = { prompt: 'Make it blue' };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_INVALID');
            }
        });

        it('returns validation error when image input is not image kind', async () => {
            const context = makeExecutionContext();
            const input: TPortPayload = {
                image: { kind: 'audio', mimeType: 'audio/mp3', uri: 'asset://x' },
                prompt: 'Make it blue'
            };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_INVALID');
            }
        });

        it('returns validation error when prompt is missing', async () => {
            const context = makeExecutionContext();
            const input: TPortPayload = { image: makeImageBinary() };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_PROMPT_REQUIRED');
            }
        });

        it('returns validation error when prompt is empty string', async () => {
            const context = makeExecutionContext();
            const input: TPortPayload = { image: makeImageBinary(), prompt: '   ' };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_PROMPT_REQUIRED');
            }
        });

        it('returns success with image output when runtime succeeds', async () => {
            const mockEdit = getMockEditImage();
            mockEdit.mockResolvedValue({
                ok: true,
                value: makeImageBinary({ uri: 'data:image/png;base64,RESULT' })
            });

            const context = makeExecutionContext();
            const input: TPortPayload = { image: makeImageBinary(), prompt: 'Make it blue' };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.image).toBeDefined();
            }
        });

        it('propagates runtime error when editImage fails', async () => {
            const mockEdit = getMockEditImage();
            mockEdit.mockResolvedValue({
                ok: false,
                error: {
                    code: 'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED',
                    message: 'Edit failed',
                    layer: 'execution',
                    retryable: false
                }
            });

            const context = makeExecutionContext();
            const input: TPortPayload = { image: makeImageBinary(), prompt: 'Make it blue' };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED');
            }
        });

        it('returns error when runtime returns non-image output', async () => {
            const mockEdit = getMockEditImage();
            mockEdit.mockResolvedValue({
                ok: true,
                value: { kind: 'audio', mimeType: 'audio/mp3', uri: 'asset://x' }
            });

            const context = makeExecutionContext();
            const input: TPortPayload = { image: makeImageBinary(), prompt: 'Make it blue' };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_INVALID');
            }
        });
    });

    describe('construction with options', () => {
        it('passes options to GeminiImageRuntime', () => {
            const options = { apiKey: 'key-123', defaultModel: 'model-x' };
            new GeminiImageEditNodeDefinition(options);
            expect(GeminiImageRuntime).toHaveBeenCalledWith(options);
        });
    });
});

// ---------------------------------------------------------------------------
// GeminiImageComposeNodeDefinition
// ---------------------------------------------------------------------------
describe('GeminiImageComposeNodeDefinition', () => {
    let node: GeminiImageComposeNodeDefinition;

    beforeEach(() => {
        vi.clearAllMocks();
        node = new GeminiImageComposeNodeDefinition();
    });

    describe('static properties', () => {
        it('has correct nodeType', () => {
            expect(node.nodeType).toBe('gemini-image-compose');
        });

        it('has correct displayName', () => {
            expect(node.displayName).toBe('Gemini Image Compose');
        });

        it('has correct category', () => {
            expect(node.category).toBe('AI');
        });

        it('has images input port', () => {
            const imagesInput = node.inputs.find((p) => p.key === 'images');
            expect(imagesInput).toBeDefined();
            expect(imagesInput?.required).toBe(true);
        });

        it('has prompt input port', () => {
            const promptInput = node.inputs.find((p) => p.key === 'prompt');
            expect(promptInput).toBeDefined();
            expect(promptInput?.required).toBe(true);
        });

        it('has image output port', () => {
            const imageOutput = node.outputs.find((p) => p.key === 'image');
            expect(imageOutput).toBeDefined();
        });
    });

    describe('estimateCost', () => {
        it('returns default cost estimate', async () => {
            const context = makeExecutionContext();
            context.nodeDefinition.config = {};
            context.nodeDefinition.nodeType = 'gemini-image-compose';
            const result = await node.taskHandler.estimateCost!({}, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.estimatedCostUsd).toBe(0.015);
            }
        });
    });

    describe('execute', () => {
        it('returns validation error when images input is missing', async () => {
            const context = makeExecutionContext();
            context.nodeDefinition.nodeType = 'gemini-image-compose';
            const input: TPortPayload = { prompt: 'Combine these' };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_INVALID');
            }
        });

        it('returns validation error when prompt is missing', async () => {
            const context = makeExecutionContext();
            context.nodeDefinition.nodeType = 'gemini-image-compose';
            const input: TPortPayload = {
                images: [makeImageBinary(), makeImageBinary()]
            };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_PROMPT_REQUIRED');
            }
        });

        it('returns validation error when prompt is empty', async () => {
            const context = makeExecutionContext();
            context.nodeDefinition.nodeType = 'gemini-image-compose';
            const input: TPortPayload = {
                images: [makeImageBinary(), makeImageBinary()],
                prompt: '  '
            };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_PROMPT_REQUIRED');
            }
        });

        it('returns success when runtime compose succeeds', async () => {
            const mockCompose = getMockComposeImages();
            mockCompose.mockResolvedValue({
                ok: true,
                value: makeImageBinary({ uri: 'data:image/png;base64,COMPOSED' })
            });

            const context = makeExecutionContext();
            context.nodeDefinition.nodeType = 'gemini-image-compose';
            const input: TPortPayload = {
                images: [makeImageBinary(), makeImageBinary()],
                prompt: 'Combine these images'
            };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.image).toBeDefined();
            }
        });

        it('propagates runtime error when composeImages fails', async () => {
            const mockCompose = getMockComposeImages();
            mockCompose.mockResolvedValue({
                ok: false,
                error: {
                    code: 'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED',
                    message: 'Compose failed',
                    layer: 'execution',
                    retryable: false
                }
            });

            const context = makeExecutionContext();
            context.nodeDefinition.nodeType = 'gemini-image-compose';
            const input: TPortPayload = {
                images: [makeImageBinary(), makeImageBinary()],
                prompt: 'Combine these images'
            };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED');
            }
        });

        it('returns error when runtime returns non-image output', async () => {
            const mockCompose = getMockComposeImages();
            mockCompose.mockResolvedValue({
                ok: true,
                value: { kind: 'audio', mimeType: 'audio/mp3', uri: 'asset://x' }
            });

            const context = makeExecutionContext();
            context.nodeDefinition.nodeType = 'gemini-image-compose';
            const input: TPortPayload = {
                images: [makeImageBinary(), makeImageBinary()],
                prompt: 'Combine these images'
            };
            const result = await node.taskHandler.execute!(input, context);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_OUTPUT_INVALID');
            }
        });
    });

    describe('construction with options', () => {
        it('passes options to GeminiImageRuntime', () => {
            const options = { apiKey: 'key-456', defaultModel: 'model-y' };
            new GeminiImageComposeNodeDefinition(options);
            expect(GeminiImageRuntime).toHaveBeenCalledWith(options);
        });
    });
});
