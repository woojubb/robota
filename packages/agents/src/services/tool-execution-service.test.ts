import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolExecutionService, ToolExecutionRequest, ToolExecutionContext } from './tool-execution-service';
import { Tools } from '../managers/tool-manager';
import { ToolInterface, ToolResult } from '../interfaces/tool';
import { ToolSchema } from '../interfaces/provider';
import { ToolExecutionError } from '../utils/errors';

// Mock Tool for testing
class MockTool implements ToolInterface {
    constructor(
        public name: string,
        public description: string = 'Mock tool',
        public schema: ToolSchema,
        private executionDelay: number = 10,
        private shouldFail: boolean = false
    ) { }

    async execute(parameters: any): Promise<ToolResult> {
        await new Promise(resolve => setTimeout(resolve, this.executionDelay));

        if (this.shouldFail) {
            return {
                success: false,
                error: `Tool ${this.name} failed intentionally`
            };
        }

        return {
            success: true,
            data: `Result from ${this.name} with params: ${JSON.stringify(parameters)}`
        };
    }

    validateParameters(parameters: any): { isValid: boolean; errors: string[] } {
        if (!parameters || typeof parameters !== 'object') {
            return { isValid: false, errors: ['Parameters must be an object'] };
        }
        return { isValid: true, errors: [] };
    }

    toFunctionDefinition(): any {
        return {
            name: this.name,
            description: this.description,
            parameters: this.schema.parameters
        };
    }
}

// Mock the Logger - 전역 모킹 방식으로 변경
vi.mock('../utils/logger', () => {
    const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    };

    return {
        Logger: vi.fn().mockImplementation(() => mockLogger),
        logger: mockLogger
    };
});

describe('ToolExecutionService', () => {
    let toolExecutionService: ToolExecutionService;
    let toolManager: Tools;
    let mockTools: MockTool[];

    beforeEach(async () => {
        toolManager = new Tools();
        await toolManager.initialize();

        mockTools = [
            new MockTool('tool1', 'First test tool', {
                name: 'tool1',
                description: 'First test tool',
                parameters: { type: 'object', properties: { input: { type: 'string' } } }
            }, 50),
            new MockTool('tool2', 'Second test tool', {
                name: 'tool2',
                description: 'Second test tool',
                parameters: { type: 'object', properties: { value: { type: 'number' } } }
            }, 30),
            new MockTool('slow-tool', 'Slow tool', {
                name: 'slow-tool',
                description: 'Slow tool',
                parameters: { type: 'object', properties: {} }
            }, 200),
            new MockTool('failing-tool', 'Failing tool', {
                name: 'failing-tool',
                description: 'Failing tool',
                parameters: { type: 'object', properties: {} }
            }, 10, true)
        ];

        // Register tools with manager
        for (const tool of mockTools) {
            toolManager.addTool(tool.schema, tool.execute.bind(tool));
        }

        toolExecutionService = new ToolExecutionService(toolManager, {
            defaultTimeout: 1000,
            defaultMaxConcurrency: 3,
            collectStats: true
        });
    });

    afterEach(async () => {
        await toolManager.dispose();
        vi.clearAllMocks();
    });

    describe('Single Tool Execution', () => {
        it('should execute a single tool successfully', async () => {
            const request: ToolExecutionRequest = {
                toolName: 'tool1',
                parameters: { input: 'test value' },
                executionId: 'test-exec-1'
            };

            const result = await toolExecutionService.executeTool(request);

            expect(result.success).toBe(true);
            expect(result.toolName).toBe('tool1');
            expect(result.result).toContain('test value');
            expect(result.executionId).toBe('test-exec-1');
            expect(result.duration).toBeGreaterThan(0);
        });

        it('should handle tool execution failure', async () => {
            const request: ToolExecutionRequest = {
                toolName: 'failing-tool',
                parameters: {}
            };

            await expect(toolExecutionService.executeTool(request)).rejects.toThrow(ToolExecutionError);
        });

        it('should validate tool exists', async () => {
            const request: ToolExecutionRequest = {
                toolName: 'non-existent-tool',
                parameters: {}
            };

            await expect(toolExecutionService.executeTool(request)).rejects.toThrow('Tool "non-existent-tool" not found');
        });

        it('should validate parameters', async () => {
            const request: ToolExecutionRequest = {
                toolName: 'tool1',
                parameters: null
            };

            await expect(toolExecutionService.executeTool(request)).rejects.toThrow('Invalid parameters');
        });

        it('should apply timeout to tool execution', async () => {
            const request: ToolExecutionRequest = {
                toolName: 'slow-tool',
                parameters: {}
            };

            const serviceWithShortTimeout = new ToolExecutionService(toolManager, {
                defaultTimeout: 50
            });

            await expect(serviceWithShortTimeout.executeTool(request)).rejects.toThrow();
        });

        it('should generate execution ID if not provided', async () => {
            const request: ToolExecutionRequest = {
                toolName: 'tool1',
                parameters: { input: 'test' }
            };

            const result = await toolExecutionService.executeTool(request);

            expect(result.executionId).toBeDefined();
            expect(result.executionId).toMatch(/^exec_\d+_[a-z0-9]+$/);
        });
    });

    describe('Parallel Execution', () => {
        it('should execute multiple tools in parallel', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'test1' } },
                    { toolName: 'tool2', parameters: { value: 42 } },
                    { toolName: 'tool1', parameters: { input: 'test2' } }
                ],
                mode: 'parallel'
            };

            const startTime = Date.now();
            const summary = await toolExecutionService.executeTools(context);
            const totalTime = Date.now() - startTime;

            expect(summary.totalExecuted).toBe(3);
            expect(summary.successful).toBe(3);
            expect(summary.failed).toBe(0);
            expect(summary.results).toHaveLength(3);

            // Parallel execution should be faster than sequential
            expect(totalTime).toBeLessThan(150); // Much less than 50+30+50 = 130ms
        });

        it('should handle partial failures in parallel execution', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'test' } },
                    { toolName: 'failing-tool', parameters: {} },
                    { toolName: 'tool2', parameters: { value: 42 } }
                ],
                mode: 'parallel'
            };

            const summary = await toolExecutionService.executeTools(context);

            expect(summary.totalExecuted).toBe(3);
            expect(summary.successful).toBe(2);
            expect(summary.failed).toBe(1);
            expect(summary.errors).toHaveLength(1);
            expect(summary.errors[0].toolName).toBe('failing-tool');
        });

        it('should respect concurrency limits', async () => {
            const context: ToolExecutionContext = {
                requests: Array.from({ length: 5 }, (_, i) => ({
                    toolName: 'tool1',
                    parameters: { input: `test${i}` }
                })),
                mode: 'parallel',
                maxConcurrency: 2
            };

            const startTime = Date.now();
            const summary = await toolExecutionService.executeTools(context);
            const totalTime = Date.now() - startTime;

            expect(summary.totalExecuted).toBe(5);
            expect(summary.successful).toBe(5);

            // With concurrency limit of 2, it should take roughly 3 batches: 2 + 2 + 1
            // So minimum time should be around 150ms (3 * 50ms)
            expect(totalTime).toBeGreaterThan(120);
        });

        it('should handle timeout in parallel execution', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'test' } },
                    { toolName: 'slow-tool', parameters: {} }
                ],
                mode: 'parallel',
                timeout: 100
            };

            const summary = await toolExecutionService.executeTools(context);

            expect(summary.totalExecuted).toBe(2);
            expect(summary.successful).toBe(1); // Only fast tool succeeds
            expect(summary.failed).toBe(1); // Slow tool times out
        });
    });

    describe('Sequential Execution', () => {
        it('should execute tools in sequence', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'first' } },
                    { toolName: 'tool2', parameters: { value: 1 } },
                    { toolName: 'tool1', parameters: { input: 'third' } }
                ],
                mode: 'sequential'
            };

            const startTime = Date.now();
            const summary = await toolExecutionService.executeTools(context);
            const totalTime = Date.now() - startTime;

            expect(summary.totalExecuted).toBe(3);
            expect(summary.successful).toBe(3);
            expect(summary.failed).toBe(0);

            // Sequential execution should take longer than parallel
            expect(totalTime).toBeGreaterThan(120); // At least 50+30+50 = 130ms
        });

        it('should stop on first error by default', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'test' } },
                    { toolName: 'failing-tool', parameters: {} },
                    { toolName: 'tool2', parameters: { value: 42 } }
                ],
                mode: 'sequential',
                continueOnError: false
            };

            const summary = await toolExecutionService.executeTools(context);

            expect(summary.totalExecuted).toBe(2); // Stops after failure
            expect(summary.successful).toBe(1);
            expect(summary.failed).toBe(1);
            expect(summary.results).toHaveLength(1); // Only successful result
        });

        it('should continue on error when configured', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'test' } },
                    { toolName: 'failing-tool', parameters: {} },
                    { toolName: 'tool2', parameters: { value: 42 } }
                ],
                mode: 'sequential',
                continueOnError: true
            };

            const summary = await toolExecutionService.executeTools(context);

            expect(summary.totalExecuted).toBe(3);
            expect(summary.successful).toBe(2);
            expect(summary.failed).toBe(1);
            expect(summary.results).toHaveLength(2); // Two successful results
        });

        it('should maintain execution order', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'first' } },
                    { toolName: 'tool2', parameters: { value: 1 } },
                    { toolName: 'tool1', parameters: { input: 'third' } }
                ],
                mode: 'sequential'
            };

            const summary = await toolExecutionService.executeTools(context);

            expect(summary.results[0].result).toContain('first');
            expect(summary.results[1].result).toContain('1');
            expect(summary.results[2].result).toContain('third');
        });
    });

    describe('Execution Statistics', () => {
        beforeEach(async () => {
            // Execute some tools to generate statistics
            await toolExecutionService.executeTool({
                toolName: 'tool1',
                parameters: { input: 'stat test 1' }
            });

            await toolExecutionService.executeTool({
                toolName: 'tool1',
                parameters: { input: 'stat test 2' }
            });

            await toolExecutionService.executeTool({
                toolName: 'tool2',
                parameters: { value: 100 }
            });

            try {
                await toolExecutionService.executeTool({
                    toolName: 'failing-tool',
                    parameters: {}
                });
            } catch {
                // Expected to fail
            }
        });

        it('should collect execution statistics', () => {
            const stats = toolExecutionService.getExecutionStats();

            expect(stats.totalExecutions).toBe(4);
            expect(stats.successRate).toBe(0.75); // 3 success out of 4
            expect(stats.averageExecutionTime).toBeGreaterThan(0);
            expect(stats.mostUsedTools).toContainEqual({ name: 'tool1', count: 2 });
            expect(stats.errorRates['failing-tool']).toBe(1.0);
        });

        it('should maintain execution history', () => {
            const history = toolExecutionService.getExecutionHistory();

            expect(history.length).toBeGreaterThan(0);

            const lastExecution = history[history.length - 1];
            expect(lastExecution.totalExecuted).toBeDefined();
            expect(lastExecution.successful).toBeDefined();
            expect(lastExecution.failed).toBeDefined();
            expect(lastExecution.totalDuration).toBeGreaterThan(0);
        });

        it('should clear statistics when requested', () => {
            toolExecutionService.clearStats();

            const stats = toolExecutionService.getExecutionStats();
            expect(stats.totalExecutions).toBe(0);
            expect(stats.mostUsedTools).toHaveLength(0);

            const history = toolExecutionService.getExecutionHistory();
            expect(history).toHaveLength(0);
        });
    });

    describe('Tool Call Integration', () => {
        it('should create execution requests from tool calls', () => {
            const toolCalls = [
                {
                    id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'tool1',
                        arguments: JSON.stringify({ param1: 'test1', param2: 123 })
                    }
                },
                {
                    id: 'call-2',
                    type: 'function',
                    function: {
                        name: 'tool2',
                        arguments: JSON.stringify({ param1: 'test2' })
                    }
                }
            ];

            const requests = toolExecutionService.createExecutionRequests(toolCalls);

            expect(requests.length).toBe(2);
            expect(requests[0].toolName).toBe('tool1');
            expect(requests[0].executionId).toBe('call-1');
            expect(requests[0].parameters).toEqual({ param1: 'test1', param2: 123 });

            expect(requests[1].toolName).toBe('tool2');
            expect(requests[1].executionId).toBe('call-2');
            expect(requests[1].parameters).toEqual({ param1: 'test2' });
        });

        it('should handle malformed tool call arguments', () => {
            const toolCalls = [
                {
                    id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'tool1',
                        arguments: 'invalid json'
                    }
                }
            ];

            expect(() => {
                toolExecutionService.createExecutionRequests(toolCalls);
            }).toThrow();
        });

        it('should format results for AI response', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'tool1', parameters: { input: 'test' } },
                    { toolName: 'tool2', parameters: { value: 42 } }
                ],
                mode: 'parallel'
            };

            const summary = await toolExecutionService.executeTools(context);
            const formattedResults = toolExecutionService.formatResultsForResponse(summary);

            expect(formattedResults).toContain('tool1');
            expect(formattedResults).toContain('tool2');
            expect(formattedResults).toContain('test');
            expect(formattedResults).toContain('42');
        });
    });

    describe('Error Handling and Recovery', () => {
        it('should handle tool manager failures gracefully', async () => {
            const failingToolManager = new Tools();
            await failingToolManager.initialize();

            // Override executeTool to fail
            failingToolManager.executeTool = async () => {
                throw new Error('Tool manager failed');
            };

            const failingService = new ToolExecutionService(failingToolManager);

            await expect(failingService.executeTool({
                toolName: 'any-tool',
                parameters: {}
            })).rejects.toThrow(ToolExecutionError);
        });

        it('should properly cleanup resources on timeout', async () => {
            const context: ToolExecutionContext = {
                requests: [
                    { toolName: 'slow-tool', parameters: {} }
                ],
                mode: 'parallel',
                timeout: 50
            };

            const summary = await toolExecutionService.executeTools(context);

            expect(summary.failed).toBe(1);
            expect(summary.errors[0].error.message).toContain('timeout');
        });

        it('should maintain service stability after errors', async () => {
            // Execute failing tool
            try {
                await toolExecutionService.executeTool({
                    toolName: 'failing-tool',
                    parameters: {}
                });
            } catch {
                // Expected
            }

            // Service should still work for subsequent calls
            const result = await toolExecutionService.executeTool({
                toolName: 'tool1',
                parameters: { input: 'after error' }
            });

            expect(result.success).toBe(true);
        });
    });

    // 새로운 테스트: 도구 실행 요청 생성 테스트
    describe('tool execution request creation', () => {
        it('should create execution requests for all tool calls', async () => {
            // 여러 도구 호출 생성
            const toolCalls = [
                {
                    id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'tool1',
                        arguments: JSON.stringify({ input: 'test1' })
                    }
                },
                {
                    id: 'call-2',
                    type: 'function',
                    function: {
                        name: 'tool2',
                        arguments: JSON.stringify({ value: 42 })
                    }
                }
            ];

            const requests = toolExecutionService.createExecutionRequests(toolCalls);

            // 모든 도구 호출이 요청으로 변환되었는지 확인
            expect(requests.length).toBe(2);
            expect(requests[0].executionId).toBe('call-1');
            expect(requests[0].toolName).toBe('tool1');
            expect(requests[1].executionId).toBe('call-2');
            expect(requests[1].toolName).toBe('tool2');
        });

        it('should handle tool calls with duplicate IDs without filtering', async () => {
            // 동일한 ID를 가진 여러 도구 호출 생성 (AI가 잘못된 응답을 한 경우 시뮬레이션)
            const toolCalls = [
                {
                    id: 'duplicate-id',
                    type: 'function',
                    function: {
                        name: 'tool1',
                        arguments: JSON.stringify({ input: 'test1' })
                    }
                },
                {
                    id: 'duplicate-id', // 의도적으로 동일한 ID 사용
                    type: 'function',
                    function: {
                        name: 'tool1',
                        arguments: JSON.stringify({ input: 'test2' })
                    }
                }
            ];

            const requests = toolExecutionService.createExecutionRequests(toolCalls);

            // 모든 요청이 생성되어야 함 (중복 제거하지 않음)
            expect(requests.length).toBe(2);
            expect(requests[0].executionId).toBe('duplicate-id');
            expect(requests[1].executionId).toBe('duplicate-id');
            expect(requests[0].parameters.input).toBe('test1');
            expect(requests[1].parameters.input).toBe('test2');
        });
    });
}); 