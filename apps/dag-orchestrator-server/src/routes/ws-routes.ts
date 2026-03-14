import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import {
    translateComfyUiEvent,
    type IComfyUiWsMessage,
} from '../services/comfyui-event-translator.js';

const DAG_RUN_ID_POLL_INTERVAL_MS = 100;
const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
    'execution.completed',
    'execution.failed',
]);

/**
 * Register WebSocket upgrade handler for DAG run progress events.
 *
 * Route: /v1/dag/runs/:id/ws
 *
 * The URL parameter `:id` can be either a preparationId (before startRun)
 * or a dagRunId (after startRun). The handler resolves the dagRunId
 * (= promptId) via `runService.getDagRunId()` for prompt filtering.
 *
 * The orchestrator bridges designer WS clients to the ComfyUI backend WS,
 * translating ComfyUI messages into Robota run progress events.
 */
export function registerWsRoutes(
    server: http.Server,
    runService: OrchestratorRunService,
    backendBaseUrl: string,
): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        const url = request.url;
        if (typeof url !== 'string') {
            socket.destroy();
            return;
        }

        const match = /^\/v1\/dag\/runs\/([^/]+)\/ws\/?$/.exec(url);
        if (!match) {
            // Not our route; let other upgrade handlers (if any) deal with it
            socket.destroy();
            return;
        }

        const urlId = match[1];

        wss.handleUpgrade(request, socket, head, (designerWs) => {
            wss.emit('connection', designerWs, request);
            handleConnection(designerWs, urlId, runService, backendBaseUrl);
        });
    });
}

/**
 * Handle a single designer WebSocket connection.
 *
 * @param urlId - The ID from the URL path. Can be a preparationId or dagRunId.
 */
function handleConnection(
    designerWs: WebSocket,
    urlId: string,
    runService: OrchestratorRunService,
    backendBaseUrl: string,
): void {
    let comfyWs: WebSocket | undefined;
    let dagRunId: string | undefined;
    let dagRunIdPollTimer: ReturnType<typeof setInterval> | undefined;
    let cleaned = false;
    const pendingMessages: (Buffer | string)[] = [];

    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;

        if (dagRunIdPollTimer !== undefined) {
            clearInterval(dagRunIdPollTimer);
            dagRunIdPollTimer = undefined;
        }

        if (comfyWs && comfyWs.readyState !== WebSocket.CLOSED) {
            comfyWs.close();
        }
        if (designerWs.readyState !== WebSocket.CLOSED) {
            designerWs.close();
        }
    };

    const sendFailedAndCleanup = (message: string): void => {
        const event = {
            dagRunId: dagRunId ?? urlId,
            eventType: 'execution.failed',
            occurredAt: new Date().toISOString(),
            error: {
                code: 'WS_BRIDGE_ERROR',
                category: 'task_execution',
                message,
                retryable: false,
            },
        };
        if (designerWs.readyState === WebSocket.OPEN) {
            designerWs.send(JSON.stringify({ event }));
        }
        cleanup();
    };

    // Designer disconnect -> cleanup ComfyUI WS
    designerWs.on('close', () => {
        cleanup();
    });
    designerWs.on('error', () => {
        cleanup();
    });

    // Build ComfyUI WS URL
    const wsBaseUrl = backendBaseUrl
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:');
    const comfyWsUrl = `${wsBaseUrl}/ws?clientId=orch-${urlId}`;

    comfyWs = new WebSocket(comfyWsUrl);

    comfyWs.on('error', () => {
        sendFailedAndCleanup('Failed to connect to ComfyUI backend');
    });

    comfyWs.on('close', () => {
        cleanup();
    });

    const processRawMessage = (raw: Buffer | string): void => {
        if (cleaned || typeof dagRunId !== 'string') return;

        let parsed: IComfyUiWsMessage;
        try {
            parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as IComfyUiWsMessage;
        } catch {
            return;
        }

        // dagRunId = promptId, so use dagRunId as both the event dagRunId and the prompt_id filter
        const events = translateComfyUiEvent(parsed, dagRunId, dagRunId);
        let isTerminal = false;

        for (const event of events) {
            runService.recordEvent(dagRunId, event);
            if (designerWs.readyState === WebSocket.OPEN) {
                designerWs.send(JSON.stringify({ event }));
            }
            if (TERMINAL_EVENT_TYPES.has(event.eventType)) {
                isTerminal = true;
            }
        }

        if (isTerminal) {
            cleanup();
        }
    };

    // Poll for dagRunId (= promptId) until it becomes available, then flush buffered messages.
    // The URL param may be a preparationId (before startRun), so we resolve the actual dagRunId.
    dagRunIdPollTimer = setInterval(() => {
        const resolvedId = runService.getDagRunId(urlId);
        if (typeof resolvedId === 'string') {
            dagRunId = resolvedId;
            if (dagRunIdPollTimer !== undefined) {
                clearInterval(dagRunIdPollTimer);
                dagRunIdPollTimer = undefined;
            }
            for (const buffered of pendingMessages) {
                processRawMessage(buffered);
            }
            pendingMessages.length = 0;
        }
    }, DAG_RUN_ID_POLL_INTERVAL_MS);

    comfyWs.on('message', (raw: Buffer | string) => {
        if (cleaned) return;
        if (typeof dagRunId !== 'string') {
            pendingMessages.push(raw);
            return;
        }
        processRawMessage(raw);
    });
}
