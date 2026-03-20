import { describe, it, expect } from 'vitest';
import {
    translateComfyUiEvent,
    type IComfyUiWsMessage,
} from '../services/comfyui-event-translator.js';
import { TASK_PROGRESS_EVENTS, EXECUTION_PROGRESS_EVENTS } from '@robota-sdk/dag-core';

const DAG_RUN_ID = 'run-001';
const PROMPT_ID = 'prompt-abc';

function msg(type: string, data: Record<string, unknown>): IComfyUiWsMessage {
    return { type, data };
}

describe('translateComfyUiEvent', () => {
    describe('executing (node started)', () => {
        it('returns task.started when node is a string', () => {
            const events = translateComfyUiEvent(
                msg('executing', { node: '5', prompt_id: PROMPT_ID }),
                DAG_RUN_ID,
                PROMPT_ID,
            );

            expect(events).toHaveLength(1);
            const [ev] = events;
            expect(ev.eventType).toBe(TASK_PROGRESS_EVENTS.STARTED);
            expect(ev.dagRunId).toBe(DAG_RUN_ID);
            if (ev.eventType === 'task.started') {
                expect(ev.nodeId).toBe('5');
                expect(ev.taskRunId).toBe(`${DAG_RUN_ID}:5`);
            }
            expect(ev.occurredAt).toBeTruthy();
        });

        it('returns empty array when node is null (execution done signal)', () => {
            const events = translateComfyUiEvent(
                msg('executing', { node: null, prompt_id: PROMPT_ID }),
                DAG_RUN_ID,
                PROMPT_ID,
            );
            expect(events).toEqual([]);
        });
    });

    describe('executed (node completed)', () => {
        it('returns task.completed with nodeId and output', () => {
            const output = { images: [{ filename: 'out.png' }] };
            const events = translateComfyUiEvent(
                msg('executed', { node: '7', output, prompt_id: PROMPT_ID }),
                DAG_RUN_ID,
                PROMPT_ID,
            );

            expect(events).toHaveLength(1);
            const [ev] = events;
            expect(ev.eventType).toBe(TASK_PROGRESS_EVENTS.COMPLETED);
            if (ev.eventType === 'task.completed') {
                expect(ev.nodeId).toBe('7');
                expect(ev.taskRunId).toBe(`${DAG_RUN_ID}:7`);
                expect(ev.output).toEqual(output);
            }
        });
    });

    describe('execution_start', () => {
        it('returns execution.started', () => {
            const events = translateComfyUiEvent(
                msg('execution_start', { prompt_id: PROMPT_ID }),
                DAG_RUN_ID,
                PROMPT_ID,
            );

            expect(events).toHaveLength(1);
            const [ev] = events;
            expect(ev.eventType).toBe(EXECUTION_PROGRESS_EVENTS.STARTED);
            if (ev.eventType === 'execution.started') {
                expect(ev.dagId).toBe('');
                expect(ev.version).toBe(0);
            }
        });
    });

    describe('execution_success', () => {
        it('returns execution.completed', () => {
            const events = translateComfyUiEvent(
                msg('execution_success', { prompt_id: PROMPT_ID }),
                DAG_RUN_ID,
                PROMPT_ID,
            );

            expect(events).toHaveLength(1);
            expect(events[0].eventType).toBe(EXECUTION_PROGRESS_EVENTS.COMPLETED);
            expect(events[0].dagRunId).toBe(DAG_RUN_ID);
        });
    });

    describe('execution_error', () => {
        it('returns task.failed and execution.failed (2 events)', () => {
            const events = translateComfyUiEvent(
                msg('execution_error', {
                    prompt_id: PROMPT_ID,
                    node_id: '3',
                    exception_message: 'OOM in VRAM',
                }),
                DAG_RUN_ID,
                PROMPT_ID,
            );

            expect(events).toHaveLength(2);

            const taskFailed = events.find((e) => e.eventType === 'task.failed');
            const execFailed = events.find((e) => e.eventType === 'execution.failed');

            expect(taskFailed).toBeDefined();
            expect(execFailed).toBeDefined();

            if (taskFailed?.eventType === 'task.failed') {
                expect(taskFailed.nodeId).toBe('3');
                expect(taskFailed.taskRunId).toBe(`${DAG_RUN_ID}:3`);
                expect(taskFailed.error).toEqual({
                    code: 'COMFYUI_EXECUTION_ERROR',
                    category: 'task_execution',
                    message: 'OOM in VRAM',
                    retryable: false,
                });
            }

            if (execFailed?.eventType === 'execution.failed') {
                expect(execFailed.error).toEqual({
                    code: 'COMFYUI_EXECUTION_ERROR',
                    category: 'task_execution',
                    message: 'OOM in VRAM',
                    retryable: false,
                });
            }
        });
    });

    describe('ignored message types', () => {
        it('returns empty array for progress messages', () => {
            const events = translateComfyUiEvent(
                msg('progress', { value: 50, max: 100 }),
                DAG_RUN_ID,
                PROMPT_ID,
            );
            expect(events).toEqual([]);
        });

        it('returns empty array for status messages', () => {
            const events = translateComfyUiEvent(
                msg('status', { status: { exec_info: { queue_remaining: 0 } } }),
                DAG_RUN_ID,
                PROMPT_ID,
            );
            expect(events).toEqual([]);
        });

        it('returns empty array for execution_cached messages', () => {
            const events = translateComfyUiEvent(
                msg('execution_cached', { nodes: ['1', '2'], prompt_id: PROMPT_ID }),
                DAG_RUN_ID,
                PROMPT_ID,
            );
            expect(events).toEqual([]);
        });
    });

    describe('prompt_id filtering', () => {
        it('returns empty array when prompt_id does not match', () => {
            const events = translateComfyUiEvent(
                msg('executing', { node: '5', prompt_id: 'other-prompt' }),
                DAG_RUN_ID,
                PROMPT_ID,
            );
            expect(events).toEqual([]);
        });

        it('returns empty array for execution_start with mismatched prompt_id', () => {
            const events = translateComfyUiEvent(
                msg('execution_start', { prompt_id: 'wrong-id' }),
                DAG_RUN_ID,
                PROMPT_ID,
            );
            expect(events).toEqual([]);
        });
    });
});
