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

interface IWsBridgeState {
    comfyWs: WebSocket | undefined;
    dagRunId: string | undefined;
    dagRunIdPollTimer: ReturnType<typeof setInterval> | undefined;
    cleaned: boolean;
    readonly pendingMessages: (Buffer | string)[];
}

function createCleanup(
    state: IWsBridgeState,
    designerWs: WebSocket,
): () => void {
    return (): void => {
        if (state.cleaned) return;
        state.cleaned = true;

        if (state.dagRunIdPollTimer !== undefined) {
            clearInterval(state.dagRunIdPollTimer);
            state.dagRunIdPollTimer = undefined;
        }

        if (state.comfyWs && state.comfyWs.readyState !== WebSocket.CLOSED) {
            state.comfyWs.close();
        }
        if (designerWs.readyState !== WebSocket.CLOSED) {
            designerWs.close();
        }
    };
}

function processRawMessage(
    raw: Buffer | string,
    state: IWsBridgeState,
    designerWs: WebSocket,
    runService: OrchestratorRunService,
    cleanup: () => void,
): void {
    if (state.cleaned || typeof state.dagRunId !== 'string') return;

    let parsed: IComfyUiWsMessage;
    try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as IComfyUiWsMessage;
    } catch {
        return;
    }

    const dagRunId = state.dagRunId;
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
}

function handleConnection(
    designerWs: WebSocket,
    urlId: string,
    runService: OrchestratorRunService,
    backendBaseUrl: string,
): void {
    const state: IWsBridgeState = {
        comfyWs: undefined,
        dagRunId: undefined,
        dagRunIdPollTimer: undefined,
        cleaned: false,
        pendingMessages: [],
    };

    const cleanup = createCleanup(state, designerWs);

    const sendFailedAndCleanup = (message: string): void => {
        const event = {
            dagRunId: state.dagRunId ?? urlId,
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

    designerWs.on('close', () => { cleanup(); });
    designerWs.on('error', () => { cleanup(); });

    const wsBaseUrl = backendBaseUrl
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:');
    state.comfyWs = new WebSocket(`${wsBaseUrl}/ws?clientId=orch-${urlId}`);

    state.comfyWs.on('error', () => {
        sendFailedAndCleanup('Failed to connect to ComfyUI backend');
    });
    state.comfyWs.on('close', () => { cleanup(); });

    state.dagRunIdPollTimer = setInterval(() => {
        const resolvedId = runService.getDagRunId(urlId);
        if (typeof resolvedId === 'string') {
            state.dagRunId = resolvedId;
            if (state.dagRunIdPollTimer !== undefined) {
                clearInterval(state.dagRunIdPollTimer);
                state.dagRunIdPollTimer = undefined;
            }
            for (const buffered of state.pendingMessages) {
                processRawMessage(buffered, state, designerWs, runService, cleanup);
            }
            state.pendingMessages.length = 0;
        }
    }, DAG_RUN_ID_POLL_INTERVAL_MS);

    state.comfyWs.on('message', (raw: Buffer | string) => {
        if (state.cleaned) return;
        if (typeof state.dagRunId !== 'string') {
            state.pendingMessages.push(raw);
            return;
        }
        processRawMessage(raw, state, designerWs, runService, cleanup);
    });
}
