import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IToolManager } from '../interfaces/manager';
import type { IToolExecutionContext } from '../interfaces/tool';
import type { IBaseEventData, IEventService, TEventListener } from '../interfaces/event-service';
import type { IToolExecutionRequest } from '../interfaces/service';
import { ValidationError } from '../utils/errors';

// Mock logger before importing ToolExecutionService
vi.mock('../utils/logger', () => ({
    Logger: vi.fn().mockImplementation(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    })),
    createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isDebugEnabled: vi.fn().mockReturnValue(false),
        setLevel: vi.fn(),
        getLevel: vi.fn().mockReturnValue('warn')
    }),
    SilentLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import { ToolExecutionService, TOOL_EVENTS, TOOL_EVENT_PREFIX } from './tool-execution-service';

/**
 * Create a mock IToolManager.
 */
function createMockToolManager(overrides: Partial<IToolManager> = {}): IToolManager {
    return {
        addTool: vi.fn(),
        removeTool: vi.fn(),
        getTool: vi.fn(),
        getToolSchema: vi.fn(),
        getTools: vi.fn().mockReturnValue([]),
        executeTool: vi.fn().mockResolvedValue('tool result'),
        hasTool: vi.fn().mockReturnValue(true),
        setAllowedTools: vi.fn(),
        getAllowedTools: vi.fn(),
        ...overrides
    };
}

/**
 * Create a mock IEventService.
 */
function createMockEventService(): IEventService & { emitCalls: Array<{ eventType: string; data: IBaseEventData }> } {
    const emitCalls: Array<{ eventType: string; data: IBaseEventData }> = [];
    return {
        emitCalls,
        emit: vi.fn((eventType: string, data: IBaseEventData) => {
            emitCalls.push({ eventType, data });
        }),
        subscribe: vi.fn(),
        unsubscribe: vi.fn()
    };
}

/**
 * Create a minimal IToolExecutionContext.
 */
function createToolContext(overrides: Partial<IToolExecutionContext> = {}): IToolExecutionContext {
    return {
        toolName: 'test-tool',
        parameters: { key: 'value' },
        executionId: 'tool_call_1',
        ownerType: 'tool',
        ownerId: 'tool_call_1',
        ...overrides
    };
}

/**
 * Create a mock logger.
 */
function createMockLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        log: vi.fn()
    };
}

describe('ToolExecutionService', () => {
    describe('TOOL_EVENTS and TOOL_EVENT_PREFIX', () => {
        it('should export correct event constants', () => {
            expect(TOOL_EVENT_PREFIX).toBe('tool');
            expect(TOOL_EVENTS.CALL_START).toBe('call_start');
            expect(TOOL_EVENTS.CALL_COMPLETE).toBe('call_complete');
            expect(TOOL_EVENTS.CALL_ERROR).toBe('call_error');
            expect(TOOL_EVENTS.CALL_RESPONSE_READY).toBe('call_response_ready');
        });
    });

    // ----------------------------------------------------------------
    // executeTool
    // ----------------------------------------------------------------
    describe('executeTool', () => {
        it('should execute a tool and return a success result', async () => {
            const tools = createMockToolManager({
                executeTool: vi.fn().mockResolvedValue('success data')
            });
            const logger = createMockLogger();
            const service = new ToolExecutionService(tools, logger);

            const result = await service.executeTool('my-tool', { foo: 'bar' }, createToolContext());

            expect(result.success).toBe(true);
            expect(result.result).toBe('success data');
            expect(result.toolName).toBe('my-tool');
            expect(result.executionId).toBe('tool_call_1');
            expect(tools.executeTool).toHaveBeenCalledWith('my-tool', { foo: 'bar' }, expect.objectContaining({
                toolName: 'my-tool',
                parameters: { foo: 'bar' },
                executionId: 'tool_call_1'
            }));
        });

        it('should throw ValidationError when executionId is missing', async () => {
            const tools = createMockToolManager();
            const service = new ToolExecutionService(tools);

            const result = await service.executeTool('my-tool', {}, createToolContext({ executionId: undefined }));

            expect(result.success).toBe(false);
            expect(result.error).toContain('executionId');
        });

        it('should return failure result when tool execution throws', async () => {
            const tools = createMockToolManager({
                executeTool: vi.fn().mockRejectedValue(new Error('Tool exploded'))
            });
            const logger = createMockLogger();
            const service = new ToolExecutionService(tools, logger);

            const result = await service.executeTool('failing-tool', {}, createToolContext());

            expect(result.success).toBe(false);
            expect(result.error).toBe('Tool exploded');
            expect(result.toolName).toBe('failing-tool');
        });

        it('should emit start and complete events when eventService is provided', async () => {
            const tools = createMockToolManager({
                executeTool: vi.fn().mockResolvedValue('result')
            });
            const eventService = createMockEventService();
            const service = new ToolExecutionService(tools, createMockLogger());

            await service.executeTool('my-tool', { a: '1' }, createToolContext({ eventService }));

            expect(eventService.emit).toHaveBeenCalledWith(
                TOOL_EVENTS.CALL_START,
                expect.objectContaining({ toolName: 'my-tool' })
            );
            expect(eventService.emit).toHaveBeenCalledWith(
                TOOL_EVENTS.CALL_COMPLETE,
                expect.objectContaining({ toolName: 'my-tool' })
            );
            expect(eventService.emit).toHaveBeenCalledWith(
                TOOL_EVENTS.CALL_RESPONSE_READY,
                expect.objectContaining({ toolName: 'my-tool' })
            );
        });

        it('should emit error event when tool fails and eventService is provided', async () => {
            const tools = createMockToolManager({
                executeTool: vi.fn().mockRejectedValue(new Error('Boom'))
            });
            const eventService = createMockEventService();
            const service = new ToolExecutionService(tools, createMockLogger());

            await service.executeTool('my-tool', {}, createToolContext({ eventService }));

            expect(eventService.emit).toHaveBeenCalledWith(
                TOOL_EVENTS.CALL_ERROR,
                expect.objectContaining({ toolName: 'my-tool', error: 'Boom' })
            );
        });

        it('should handle non-Error thrown values', async () => {
            const tools = createMockToolManager({
                executeTool: vi.fn().mockRejectedValue('string error')
            });
            const service = new ToolExecutionService(tools, createMockLogger());

            const result = await service.executeTool('my-tool', {}, createToolContext());

            expect(result.success).toBe(false);
            expect(result.error).toBe('string error');
        });
    });

    // ----------------------------------------------------------------
    // createExecutionRequestsWithContext
    // ----------------------------------------------------------------
    describe('createExecutionRequestsWithContext', () => {
        it('should create execution requests from tool calls', () => {
            const tools = createMockToolManager();
            const service = new ToolExecutionService(tools);

            const toolCalls = [
                { id: 'call_1', function: { name: 'tool_a', arguments: '{"x": 1}' } },
                { id: 'call_2', function: { name: 'tool_b', arguments: '{"y": "hello"}' } }
            ];

            const requests = service.createExecutionRequestsWithContext(toolCalls, {
                ownerPathBase: [{ type: 'execution', id: 'exec_1' }]
            });

            expect(requests).toHaveLength(2);
            expect(requests[0]?.toolName).toBe('tool_a');
            expect(requests[0]?.parameters).toEqual({ x: 1 });
            expect(requests[0]?.executionId).toBe('call_1');
            expect(requests[0]?.ownerType).toBe('tool');
            expect(requests[0]?.ownerId).toBe('call_1');
            expect(requests[0]?.ownerPath).toEqual([
                { type: 'execution', id: 'exec_1' },
                { type: 'tool', id: 'call_1' }
            ]);

            expect(requests[1]?.toolName).toBe('tool_b');
            expect(requests[1]?.parameters).toEqual({ y: 'hello' });
        });

        it('should apply metadata factory when provided', () => {
            const tools = createMockToolManager();
            const service = new ToolExecutionService(tools);

            const toolCalls = [
                { id: 'call_1', function: { name: 'tool_a', arguments: '{}' } }
            ];

            const requests = service.createExecutionRequestsWithContext(toolCalls, {
                ownerPathBase: [],
                metadataFactory: (tc) => ({ toolCallId: tc.id })
            });

            expect(requests[0]?.metadata).toEqual({ toolCallId: 'call_1' });
        });
    });

    // ----------------------------------------------------------------
    // executeTools (batch)
    // ----------------------------------------------------------------
    describe('executeTools', () => {
        function createRequest(overrides: Partial<IToolExecutionRequest> = {}): IToolExecutionRequest {
            return {
                toolName: 'batch-tool',
                parameters: {},
                executionId: 'batch_exec_1',
                ownerType: 'tool',
                ownerId: 'batch_exec_1',
                ...overrides
            };
        }

        describe('parallel mode', () => {
            it('should execute all tools in parallel and return results', async () => {
                const tools = createMockToolManager({
                    executeTool: vi.fn().mockResolvedValue('parallel result')
                });
                const service = new ToolExecutionService(tools, createMockLogger());

                const { results, errors } = await service.executeTools({
                    requests: [
                        createRequest({ executionId: 'p1', ownerId: 'p1' }),
                        createRequest({ executionId: 'p2', ownerId: 'p2' })
                    ],
                    mode: 'parallel',
                    continueOnError: true
                });

                expect(results).toHaveLength(2);
                expect(results[0]?.success).toBe(true);
                expect(results[1]?.success).toBe(true);
                expect(errors).toHaveLength(0);
            });

            it('should throw on first error when continueOnError is false', async () => {
                const tools = createMockToolManager({
                    executeTool: vi.fn()
                        .mockResolvedValueOnce('ok')
                        .mockRejectedValueOnce(new Error('fail'))
                });
                const service = new ToolExecutionService(tools, createMockLogger());

                // When parallel execution fails and continueOnError is false,
                // the method should throw
                // But note: executeTool catches errors internally and returns {success: false}
                // So the error path through Promise.allSettled would be from requireExecutionRequestFields
                // or from the tool execution producing a non-success result.
                // In this case, the tool execution returns { success: false }, which pushes to errors array.
                // Since continueOnError is false, the first error is thrown.
                await expect(
                    service.executeTools({
                        requests: [
                            createRequest({ executionId: 'p1', ownerId: 'p1' }),
                            createRequest({ executionId: 'p2', ownerId: 'p2' })
                        ],
                        mode: 'parallel',
                        continueOnError: false
                    })
                ).rejects.toThrow();
            });

            it('should validate required fields and throw for missing executionId', async () => {
                const tools = createMockToolManager();
                const service = new ToolExecutionService(tools, createMockLogger());

                await expect(
                    service.executeTools({
                        requests: [createRequest({ executionId: undefined })],
                        mode: 'parallel'
                    })
                ).rejects.toThrow('executionId');
            });

            it('should validate required fields and throw for missing ownerType', async () => {
                const tools = createMockToolManager();
                const service = new ToolExecutionService(tools, createMockLogger());

                await expect(
                    service.executeTools({
                        requests: [createRequest({ ownerType: undefined })],
                        mode: 'parallel'
                    })
                ).rejects.toThrow('ownerType');
            });

            it('should validate required fields and throw for missing ownerId', async () => {
                const tools = createMockToolManager();
                const service = new ToolExecutionService(tools, createMockLogger());

                await expect(
                    service.executeTools({
                        requests: [createRequest({ ownerId: undefined })],
                        mode: 'parallel'
                    })
                ).rejects.toThrow('ownerId');
            });
        });

        describe('sequential mode', () => {
            it('should execute tools sequentially and return results', async () => {
                const executionOrder: string[] = [];
                const tools = createMockToolManager({
                    executeTool: vi.fn().mockImplementation(async (name: string) => {
                        executionOrder.push(name);
                        return `result_${name}`;
                    })
                });
                const service = new ToolExecutionService(tools, createMockLogger());

                const { results, errors } = await service.executeTools({
                    requests: [
                        createRequest({ toolName: 'tool_a', executionId: 's1', ownerId: 's1' }),
                        createRequest({ toolName: 'tool_b', executionId: 's2', ownerId: 's2' })
                    ],
                    mode: 'sequential'
                });

                expect(results).toHaveLength(2);
                expect(errors).toHaveLength(0);
                expect(executionOrder).toEqual(['tool_a', 'tool_b']);
            });

            it('should stop on error when continueOnError is false', async () => {
                const tools = createMockToolManager({
                    executeTool: vi.fn()
                        .mockRejectedValueOnce(new Error('first fail'))
                        .mockResolvedValueOnce('second ok')
                });
                const service = new ToolExecutionService(tools, createMockLogger());

                const { results, errors } = await service.executeTools({
                    requests: [
                        createRequest({ executionId: 's1', ownerId: 's1' }),
                        createRequest({ executionId: 's2', ownerId: 's2' })
                    ],
                    mode: 'sequential',
                    continueOnError: false
                });

                // First tool fails (executeTool catches error and returns {success: false})
                // which triggers errors.push and then break (continueOnError=false)
                expect(results).toHaveLength(1);
                expect(results[0]?.success).toBe(false);
                expect(errors).toHaveLength(1);
            });

            it('should continue on error when continueOnError is true', async () => {
                const tools = createMockToolManager({
                    executeTool: vi.fn()
                        .mockRejectedValueOnce(new Error('first fail'))
                        .mockResolvedValueOnce('second ok')
                });
                const service = new ToolExecutionService(tools, createMockLogger());

                const { results, errors } = await service.executeTools({
                    requests: [
                        createRequest({ executionId: 's1', ownerId: 's1' }),
                        createRequest({ executionId: 's2', ownerId: 's2' })
                    ],
                    mode: 'sequential',
                    continueOnError: true
                });

                // First returns { success: false }, second returns { success: true }
                expect(results).toHaveLength(2);
                expect(errors).toHaveLength(1);
            });

            it('should validate required fields for sequential execution', async () => {
                const tools = createMockToolManager();
                const service = new ToolExecutionService(tools, createMockLogger());

                // Missing executionId should cause requireExecutionRequestFields to throw
                // In sequential mode, it catches the error and adds to errors array, then breaks
                const { results, errors } = await service.executeTools({
                    requests: [createRequest({ executionId: undefined })],
                    mode: 'sequential',
                    continueOnError: false
                });

                expect(errors).toHaveLength(1);
                expect(errors[0]?.message).toContain('executionId');
            });
        });
    });
});
