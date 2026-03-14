import type { TRunProgressEvent, IDagError, TPortPayload } from '@robota-sdk/dag-core';

/** Shape of a ComfyUI WebSocket message after JSON.parse. */
export interface IComfyUiWsMessage {
    type: string;
    data: Record<string, unknown>;
}

/**
 * Translate a ComfyUI WebSocket message into zero or more Robota run progress events.
 *
 * Returns an empty array for unrecognised or irrelevant messages (progress, status)
 * and for messages whose prompt_id does not match the expected one.
 */
export function translateComfyUiEvent(
    message: IComfyUiWsMessage,
    dagRunId: string,
    expectedPromptId: string,
): TRunProgressEvent[] {
    const { type, data } = message;
    const promptId = data.prompt_id as string | undefined;

    // Messages without prompt_id that we always ignore (progress, status, etc.)
    const ALWAYS_IGNORED: ReadonlySet<string> = new Set(['progress', 'status', 'execution_cached']);
    if (ALWAYS_IGNORED.has(type)) {
        return [];
    }

    // Filter by prompt_id
    if (promptId !== expectedPromptId) {
        return [];
    }

    const now = new Date().toISOString();

    switch (type) {
        case 'executing': {
            const node = data.node;
            // node === null means "execution finished for this prompt" — ignore
            if (node === null || node === undefined) {
                return [];
            }
            const nodeId = String(node);
            return [{
                dagRunId,
                eventType: 'task.started',
                occurredAt: now,
                taskRunId: `${dagRunId}:${nodeId}`,
                nodeId,
            }];
        }

        case 'executed': {
            const nodeId = String(data.node);
            const output = data.output as TPortPayload | undefined;
            return [{
                dagRunId,
                eventType: 'task.completed',
                occurredAt: now,
                taskRunId: `${dagRunId}:${nodeId}`,
                nodeId,
                output,
            }];
        }

        case 'execution_start': {
            return [{
                dagRunId,
                eventType: 'execution.started',
                occurredAt: now,
                dagId: '',
                version: 0,
            }];
        }

        case 'execution_success': {
            return [{
                dagRunId,
                eventType: 'execution.completed',
                occurredAt: now,
            }];
        }

        case 'execution_error': {
            const nodeId = String(data.node_id);
            const exceptionMessage = String(data.exception_message ?? 'Unknown error');
            const error: IDagError = {
                code: 'COMFYUI_EXECUTION_ERROR',
                category: 'task_execution',
                message: exceptionMessage,
                retryable: false,
            };
            return [
                {
                    dagRunId,
                    eventType: 'task.failed',
                    occurredAt: now,
                    taskRunId: `${dagRunId}:${nodeId}`,
                    nodeId,
                    error,
                },
                {
                    dagRunId,
                    eventType: 'execution.failed',
                    occurredAt: now,
                    error,
                },
            ];
        }

        default:
            return [];
    }
}
