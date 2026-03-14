import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import {
    translateComfyUiEvent,
    type IComfyUiWsMessage,
} from '../services/comfyui-event-translator.js';

const PROMPT_ID_POLL_INTERVAL_MS = 100;
const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
    'execution.completed',
    'execution.failed',
]);

/**
 * Register WebSocket upgrade handler for DAG run progress events.
 *
 * Route: /v1/dag/runs/:dagRunId/ws
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

        const dagRunId = match[1];

        wss.handleUpgrade(request, socket, head, (designerWs) => {
            wss.emit('connection', designerWs, request);
            handleConnection(designerWs, dagRunId, runService, backendBaseUrl);
        });
    });
}

function handleConnection(
    designerWs: WebSocket,
    dagRunId: string,
    runService: OrchestratorRunService,
    backendBaseUrl: string,
): void {
    let comfyWs: WebSocket | undefined;
    let promptId: string | undefined;
    let promptIdPollTimer: ReturnType<typeof setInterval> | undefined;
    let cleaned = false;
    const pendingMessages: (Buffer | string)[] = [];

    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;

        if (promptIdPollTimer !== undefined) {
            clearInterval(promptIdPollTimer);
            promptIdPollTimer = undefined;
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
            dagRunId,
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
    const comfyWsUrl = `${wsBaseUrl}/ws?clientId=orch-${dagRunId}`;

    comfyWs = new WebSocket(comfyWsUrl);

    comfyWs.on('error', () => {
        sendFailedAndCleanup('Failed to connect to ComfyUI backend');
    });

    comfyWs.on('close', () => {
        cleanup();
    });

    const processRawMessage = (raw: Buffer | string): void => {
        if (cleaned || typeof promptId !== 'string') return;

        let parsed: IComfyUiWsMessage;
        try {
            parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as IComfyUiWsMessage;
        } catch {
            return;
        }

        const events = translateComfyUiEvent(parsed, dagRunId, promptId);
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

    // Poll for promptId until it becomes available, then flush buffered messages
    promptIdPollTimer = setInterval(() => {
        const id = runService.getPromptIdForRun(dagRunId);
        if (typeof id === 'string') {
            promptId = id;
            if (promptIdPollTimer !== undefined) {
                clearInterval(promptIdPollTimer);
                promptIdPollTimer = undefined;
            }
            for (const buffered of pendingMessages) {
                processRawMessage(buffered);
            }
            pendingMessages.length = 0;
        }
    }, PROMPT_ID_POLL_INTERVAL_MS);

    comfyWs.on('message', (raw: Buffer | string) => {
        if (cleaned) return;
        if (typeof promptId !== 'string') {
            pendingMessages.push(raw);
            return;
        }
        processRawMessage(raw);
    });
}
