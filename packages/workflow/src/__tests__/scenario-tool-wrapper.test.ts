import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { IParameterValidationResult, ITool, IToolExecutionContext, IToolResult, TToolParameters, TUniversalValue } from '@robota-sdk/agents';
import { ScenarioStore } from '../scenario/store.js';
import { createScenarioToolWrapper } from '../scenario/tool.js';
import { stringifyToolArguments } from '../scenario/request-utils.js';

function createTestTool(options?: { onExecute?: () => void }): ITool {
    return {
        schema: {
            name: 'calculator',
            description: 'Calculator tool',
            parameters: {
                type: 'object',
                properties: {
                    a: { type: 'number' },
                    b: { type: 'number' }
                },
                required: ['a', 'b']
            }
        },
        async execute(parameters: TToolParameters, _context?: IToolExecutionContext): Promise<IToolResult> {
            options?.onExecute?.();
            const a = typeof parameters['a'] === 'number' ? parameters['a'] : 0;
            const b = typeof parameters['b'] === 'number' ? parameters['b'] : 0;
            return { success: true, data: a + b };
        },
        validate(_parameters: TToolParameters): boolean {
            return true;
        },
        validateParameters(_parameters: TToolParameters): IParameterValidationResult {
            return { isValid: true, errors: [] };
        },
        getDescription(): string {
            return 'Calculator tool';
        }
    };
}

async function createTestStore(): Promise<{ store: ScenarioStore; scenarioId: string; cleanup: () => Promise<void> }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'robota-workflow-scenario-'));
    return {
        store: new ScenarioStore({ baseDir: tempDir }),
        scenarioId: 'scenario_play_test',
        cleanup: async () => {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    };
}

describe('createScenarioToolWrapper', () => {
    it('should return recorded success result in play mode without executing real tool', async () => {
        const setup = await createTestStore();
        try {
            let executeCount = 0;
            const tool = createTestTool({ onExecute: () => { executeCount += 1; } });
            const params: TToolParameters = { a: 1, b: 2 };
            const toolCallId = 'tool_call_1';
            const recordedResult: TUniversalValue = 777;

            await setup.store.appendToolResultStep({
                scenarioId: setup.scenarioId,
                toolCallId,
                toolName: tool.schema.name,
                toolArguments: stringifyToolArguments(params),
                toolMessageContent: String(recordedResult),
                resultData: recordedResult,
                success: true
            });

            const wrapper = createScenarioToolWrapper(tool, {
                mode: 'play',
                scenarioId: setup.scenarioId,
                store: setup.store
            });

            const result = await wrapper.fn(params, { executionId: toolCallId });
            expect(result).toBe(recordedResult);
            expect(executeCount).toBe(0);
        } finally {
            await setup.cleanup();
        }
    });

    it('should throw recorded error in play mode without executing real tool', async () => {
        const setup = await createTestStore();
        try {
            let executeCount = 0;
            const tool = createTestTool({ onExecute: () => { executeCount += 1; } });
            const params: TToolParameters = { a: 3, b: 4 };
            const toolCallId = 'tool_call_2';

            await setup.store.appendToolResultStep({
                scenarioId: setup.scenarioId,
                toolCallId,
                toolName: tool.schema.name,
                toolArguments: stringifyToolArguments(params),
                toolMessageContent: 'Error: simulated error',
                success: false,
                errorMessage: 'simulated error'
            });

            const wrapper = createScenarioToolWrapper(tool, {
                mode: 'play',
                scenarioId: setup.scenarioId,
                store: setup.store
            });

            await expect(wrapper.fn(params, { executionId: toolCallId })).rejects.toThrow('simulated error');
            expect(executeCount).toBe(0);
        } finally {
            await setup.cleanup();
        }
    });

    it('should fail when recorded tool metadata mismatches runtime request in play mode', async () => {
        const setup = await createTestStore();
        try {
            let executeCount = 0;
            const tool = createTestTool({ onExecute: () => { executeCount += 1; } });
            const params: TToolParameters = { a: 5, b: 6 };
            const toolCallId = 'tool_call_3';

            await setup.store.appendToolResultStep({
                scenarioId: setup.scenarioId,
                toolCallId,
                toolName: 'different_tool',
                toolArguments: stringifyToolArguments({ a: 999, b: 999 }),
                toolMessageContent: '0',
                resultData: 0,
                success: true
            });

            const wrapper = createScenarioToolWrapper(tool, {
                mode: 'play',
                scenarioId: setup.scenarioId,
                store: setup.store
            });

            await expect(wrapper.fn(params, { executionId: toolCallId })).rejects.toThrow('SCENARIO-TOOL-MISMATCH');
            expect(executeCount).toBe(0);
        } finally {
            await setup.cleanup();
        }
    });
});
