import { WebSocketServer, WebSocket } from 'ws';
import type http from 'node:http';
import type { IRunProgressEventBus } from '@robota-sdk/dag-api';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import { TASK_PROGRESS_EVENTS, EXECUTION_PROGRESS_EVENTS } from '@robota-sdk/dag-core';

/** Minimal contract for resolving a prompt ID from a DAG run ID. */
interface IPromptIdResolver {
    getPromptIdForDagRun(dagRunId: string): string | undefined;
}

/**
 * Converts an internal run progress event into a ComfyUI-compatible WebSocket message.
 * Returns undefined when no message should be sent for the given event type.
 */
function toComfyUiMessage(event: TRunProgressEvent, promptId: string): object | undefined {
    switch (event.eventType) {
        case EXECUTION_PROGRESS_EVENTS.STARTED:
            return { type: 'execution_start', data: { prompt_id: promptId } };
        case TASK_PROGRESS_EVENTS.STARTED:
            return { type: 'executing', data: { node: event.nodeId, prompt_id: promptId } };
        case TASK_PROGRESS_EVENTS.COMPLETED:
            return { type: 'executed', data: { node: event.nodeId, output: event.output, prompt_id: promptId } };
        case TASK_PROGRESS_EVENTS.FAILED:
            return {
                type: 'execution_error',
                data: {
                    prompt_id: promptId,
                    node_id: event.nodeId,
                    exception_message: event.error.message,
                },
            };
        case EXECUTION_PROGRESS_EVENTS.COMPLETED:
            return { type: 'execution_success', data: { prompt_id: promptId } };
        case EXECUTION_PROGRESS_EVENTS.FAILED:
            return undefined;
        default:
            return undefined;
    }
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

        const message = toComfyUiMessage(event, promptId);
        if (typeof message === 'undefined') {
            return;
        }

        const payload = JSON.stringify(message);
        for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    });
}
