import { describe, it, expect } from 'vitest';
import { toComfyUiMessages } from '../routes/ws-routes.js';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';

describe('ComfyUI WebSocket event mapping', () => {
    const promptId = 'test-prompt-1';

    describe('status event', () => {
        it('emits status with queue_remaining 1 on execution.started', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.started',
                occurredAt: new Date().toISOString(),
                dagId: 'dag-1',
                version: 1,
            };
            const messages = toComfyUiMessages(event, promptId);
            const statusMsg = messages.find((m) => m.type === 'status');
            expect(statusMsg).toBeDefined();
            expect(statusMsg!.data).toEqual({ status: { exec_info: { queue_remaining: 1 } } });
        });

        it('emits status with queue_remaining 0 on execution.completed', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.completed',
                occurredAt: new Date().toISOString(),
            };
            const messages = toComfyUiMessages(event, promptId);
            const statusMsg = messages.find((m) => m.type === 'status');
            expect(statusMsg).toBeDefined();
            expect(statusMsg!.data).toEqual({ status: { exec_info: { queue_remaining: 0 } } });
        });

        it('emits status with queue_remaining 0 on execution.failed', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.failed',
                occurredAt: new Date().toISOString(),
                error: { code: 'TEST', category: 'task_execution', message: 'fail', retryable: false },
            };
            const messages = toComfyUiMessages(event, promptId);
            const statusMsg = messages.find((m) => m.type === 'status');
            expect(statusMsg).toBeDefined();
            expect(statusMsg!.data).toEqual({ status: { exec_info: { queue_remaining: 0 } } });
        });
    });

    describe('execution_cached event', () => {
        it('emits execution_cached with empty nodes on execution.started', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.started',
                occurredAt: new Date().toISOString(),
                dagId: 'dag-1',
                version: 1,
            };
            const messages = toComfyUiMessages(event, promptId);
            const cachedMsg = messages.find((m) => m.type === 'execution_cached');
            expect(cachedMsg).toBeDefined();
            expect(cachedMsg!.data).toEqual({ nodes: [], prompt_id: promptId });
        });
    });

    describe('existing event mappings are preserved', () => {
        it('execution.started also emits execution_start', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.started',
                occurredAt: new Date().toISOString(),
                dagId: 'dag-1',
                version: 1,
            };
            const messages = toComfyUiMessages(event, promptId);
            const startMsg = messages.find((m) => m.type === 'execution_start');
            expect(startMsg).toBeDefined();
            expect(startMsg!.data).toEqual({ prompt_id: promptId });
        });

        it('execution.started produces exactly 3 messages (status + cached + start)', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.started',
                occurredAt: new Date().toISOString(),
                dagId: 'dag-1',
                version: 1,
            };
            const messages = toComfyUiMessages(event, promptId);
            expect(messages).toHaveLength(3);
        });

        it('task.started emits executing', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'task.started',
                occurredAt: new Date().toISOString(),
                taskRunId: 'task-1',
                nodeId: 'node-1',
            };
            const messages = toComfyUiMessages(event, promptId);
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({ type: 'executing', data: { node: 'node-1', prompt_id: promptId } });
        });

        it('task.completed emits executed', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'task.completed',
                occurredAt: new Date().toISOString(),
                taskRunId: 'task-1',
                nodeId: 'node-1',
                output: { text: 'hello' },
            };
            const messages = toComfyUiMessages(event, promptId);
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({
                type: 'executed',
                data: { node: 'node-1', output: { text: 'hello' }, prompt_id: promptId },
            });
        });

        it('task.failed emits execution_error', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'task.failed',
                occurredAt: new Date().toISOString(),
                taskRunId: 'task-1',
                nodeId: 'node-1',
                error: { code: 'ERR', category: 'task_execution', message: 'oops', retryable: false },
            };
            const messages = toComfyUiMessages(event, promptId);
            expect(messages).toHaveLength(1);
            expect(messages[0].type).toBe('execution_error');
        });

        it('execution.completed emits execution_success + status', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.completed',
                occurredAt: new Date().toISOString(),
            };
            const messages = toComfyUiMessages(event, promptId);
            expect(messages).toHaveLength(2);
            expect(messages.find((m) => m.type === 'execution_success')).toBeDefined();
            expect(messages.find((m) => m.type === 'status')).toBeDefined();
        });

        it('execution.failed emits only status (no execution_success)', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.failed',
                occurredAt: new Date().toISOString(),
                error: { code: 'ERR', category: 'task_execution', message: 'boom', retryable: false },
            };
            const messages = toComfyUiMessages(event, promptId);
            expect(messages).toHaveLength(1);
            expect(messages[0].type).toBe('status');
        });
    });
});
