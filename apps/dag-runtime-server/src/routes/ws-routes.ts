import { WebSocketServer, WebSocket } from 'ws';
import type http from 'node:http';
import type { IRunProgressEventBus } from '@robota-sdk/dag-api';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import { TASK_PROGRESS_EVENTS, EXECUTION_PROGRESS_EVENTS } from '@robota-sdk/dag-core';

/** Minimal contract for resolving a prompt ID from a DAG run ID. */
interface IPromptIdResolver {
    getPromptIdForDagRun(dagRunId: string): string | undefined;
}

/** ComfyUI WebSocket message shape. */
export interface IComfyUiWsMessage {
    type: string;
    data: Record<string, unknown>;
}

/**
 * Converts an internal run progress event into ComfyUI-compatible WebSocket messages.
 * Some events produce multiple ComfyUI messages (e.g., execution.started → status + execution_cached + execution_start).
 */
export function toComfyUiMessages(event: TRunProgressEvent, promptId: string): IComfyUiWsMessage[] {
    const messages: IComfyUiWsMessage[] = [];

    switch (event.eventType) {
        case EXECUTION_PROGRESS_EVENTS.STARTED:
            messages.push({ type: 'status', data: { status: { exec_info: { queue_remaining: 1 } } } });
            messages.push({ type: 'execution_cached', data: { nodes: [], prompt_id: promptId } });
            messages.push({ type: 'execution_start', data: { prompt_id: promptId } });
            break;
        case TASK_PROGRESS_EVENTS.STARTED:
            messages.push({ type: 'executing', data: { node: event.nodeId, prompt_id: promptId } });
            break;
        case TASK_PROGRESS_EVENTS.COMPLETED:
            messages.push({ type: 'executed', data: { node: event.nodeId, output: event.output, prompt_id: promptId } });
            break;
        case TASK_PROGRESS_EVENTS.FAILED:
            messages.push({
                type: 'execution_error',
                data: {
                    prompt_id: promptId,
                    node_id: event.nodeId,
                    exception_message: event.error.message,
                },
            });
            break;
        case EXECUTION_PROGRESS_EVENTS.COMPLETED:
            messages.push({ type: 'execution_success', data: { prompt_id: promptId } });
            messages.push({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } });
            break;
        case EXECUTION_PROGRESS_EVENTS.FAILED:
            messages.push({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } });
            break;
    }

    return messages;
}

/**
 * Attaches a WebSocket server to the given HTTP server at `/ws`.
 * Subscribes to the run progress event bus and broadcasts ComfyUI-formatted
 * messages to all connected WebSocket clients.
 */
export function mountWsRoutes(
    server: http.Server,
    eventBus: IRunProgressEventBus,
    promptIdResolver: IPromptIdResolver,
): void {
    const wss = new WebSocketServer({ server, path: '/ws' });

    eventBus.subscribe((event: TRunProgressEvent) => {
        const promptId = promptIdResolver.getPromptIdForDagRun(event.dagRunId);
        if (typeof promptId === 'undefined') {
            return;
        }

        const messages = toComfyUiMessages(event, promptId);
        for (const message of messages) {
            const payload = JSON.stringify(message);
            for (const client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            }
        }
    });
}
