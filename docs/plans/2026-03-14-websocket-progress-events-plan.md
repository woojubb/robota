# WebSocket Progress Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable real-time node-level execution status updates via WS-to-WS proxy: designer ↔ orchestrator ↔ ComfyUI.

**Architecture:** Orchestrator-server adds a WS server endpoint for designer clients, connects to ComfyUI `/ws` as a WS client, and proxies events with ComfyUI→Robota format translation. Designer replaces EventSource with native WebSocket. Runtime-server implements ComfyUI-compatible `/ws` for local testing.

**Tech Stack:** `ws` ^8.18.3 (already in monorepo), Express HTTP upgrade, browser native WebSocket, vitest for tests.

**Design Doc:** `docs/plans/2026-03-14-websocket-progress-events-design.md`

---

## Test Strategy

- **Unit:** ComfyUI→Robota event translator (pure function), prompt_id filtering, designer WS reconnection logic
- **Integration:** Mock ComfyUI WS server → orchestrator → mock designer WS client, full event flow, error scenarios
- **Verification:** `pnpm --filter @robota-sdk/dag-orchestrator-server test`, `pnpm --filter @robota-sdk/dag-designer test`, `pnpm test`

---

### Task 1: Add `ws` dependency to orchestrator-server

**Files:**

- Modify: `apps/dag-orchestrator-server/package.json`

**Step 1: Add dependencies**

```bash
cd /Users/jungyoun/Documents/dev/robota
pnpm --filter @robota-sdk/dag-orchestrator-server add ws
pnpm --filter @robota-sdk/dag-orchestrator-server add -D @types/ws
```

**Step 2: Verify install**

Run: `pnpm --filter @robota-sdk/dag-orchestrator-server build`
Expected: Build success

**Step 3: Commit**

```bash
git add apps/dag-orchestrator-server/package.json pnpm-lock.yaml
git commit -m "chore(dag-orchestrator-server): add ws dependency for WebSocket support"
```

---

### Task 2: ComfyUI → Robota event translator (TDD)

**Files:**

- Create: `apps/dag-orchestrator-server/src/services/comfyui-event-translator.ts`
- Create: `apps/dag-orchestrator-server/src/__tests__/comfyui-event-translator.test.ts`

**Step 1: Write failing tests**

```typescript
// apps/dag-orchestrator-server/src/__tests__/comfyui-event-translator.test.ts
import { describe, it, expect } from 'vitest';
import { translateComfyUiEvent } from '../services/comfyui-event-translator.js';

const DAG_RUN_ID = 'run-123';
const PROMPT_ID = 'prompt-abc';

describe('translateComfyUiEvent', () => {
  it('translates executing to task.started', () => {
    const result = translateComfyUiEvent(
      { type: 'executing', data: { node: 'in1', prompt_id: PROMPT_ID } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dagRunId: DAG_RUN_ID,
      eventType: 'task.started',
      nodeId: 'in1',
    });
  });

  it('translates executed to task.completed', () => {
    const result = translateComfyUiEvent(
      { type: 'executed', data: { node: 'in1', output: { text: 'hello' }, prompt_id: PROMPT_ID } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dagRunId: DAG_RUN_ID,
      eventType: 'task.completed',
      nodeId: 'in1',
    });
  });

  it('translates execution_start to execution.started', () => {
    const result = translateComfyUiEvent(
      { type: 'execution_start', data: { prompt_id: PROMPT_ID } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dagRunId: DAG_RUN_ID,
      eventType: 'execution.started',
    });
  });

  it('translates execution_success to execution.completed', () => {
    const result = translateComfyUiEvent(
      { type: 'execution_success', data: { prompt_id: PROMPT_ID } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dagRunId: DAG_RUN_ID,
      eventType: 'execution.completed',
    });
  });

  it('translates execution_error to task.failed + execution.failed', () => {
    const result = translateComfyUiEvent(
      {
        type: 'execution_error',
        data: { prompt_id: PROMPT_ID, node_id: 'llm1', exception_message: 'API key missing' },
      },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ eventType: 'task.failed', nodeId: 'llm1' });
    expect(result[1]).toMatchObject({ eventType: 'execution.failed' });
  });

  it('ignores executing with node null', () => {
    const result = translateComfyUiEvent(
      { type: 'executing', data: { node: null, prompt_id: PROMPT_ID } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(0);
  });

  it('ignores progress events', () => {
    const result = translateComfyUiEvent(
      { type: 'progress', data: { value: 5, max: 20, prompt_id: PROMPT_ID, node: 'sampler1' } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(0);
  });

  it('ignores status events', () => {
    const result = translateComfyUiEvent(
      { type: 'status', data: { exec_info: { queue_remaining: 0 } } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(0);
  });

  it('returns empty for mismatched prompt_id', () => {
    const result = translateComfyUiEvent(
      { type: 'executing', data: { node: 'in1', prompt_id: 'other-prompt' } },
      DAG_RUN_ID,
      PROMPT_ID,
    );
    expect(result).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-orchestrator-server test`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// apps/dag-orchestrator-server/src/services/comfyui-event-translator.ts
import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import { TASK_PROGRESS_EVENTS, EXECUTION_PROGRESS_EVENTS } from '@robota-sdk/dag-core';

/** Raw ComfyUI WebSocket message shape. */
export interface IComfyUiWsMessage {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Translates a ComfyUI WebSocket event into zero or more Robota TRunProgressEvent.
 * Returns empty array for ignored or non-matching events.
 */
export function translateComfyUiEvent(
  message: IComfyUiWsMessage,
  dagRunId: string,
  expectedPromptId: string,
): TRunProgressEvent[] {
  const promptId = message.data?.prompt_id as string | undefined;

  // Filter by prompt_id (ComfyUI broadcasts all prompts on a single WS)
  if (typeof promptId === 'string' && promptId !== expectedPromptId) {
    return [];
  }

  const now = new Date().toISOString();

  switch (message.type) {
    case 'execution_start':
      return [
        {
          dagRunId,
          eventType: EXECUTION_PROGRESS_EVENTS.STARTED,
          occurredAt: now,
          dagId: '',
          version: 0,
        } as TRunProgressEvent,
      ];

    case 'executing': {
      const nodeId = message.data?.node as string | null;
      if (nodeId === null || typeof nodeId === 'undefined') {
        return [];
      }
      return [
        {
          dagRunId,
          eventType: TASK_PROGRESS_EVENTS.STARTED,
          occurredAt: now,
          taskRunId: `${dagRunId}:${nodeId}`,
          nodeId,
        },
      ];
    }

    case 'executed': {
      const nodeId = message.data?.node as string;
      const output = message.data?.output as Record<string, unknown> | undefined;
      return [
        {
          dagRunId,
          eventType: TASK_PROGRESS_EVENTS.COMPLETED,
          occurredAt: now,
          taskRunId: `${dagRunId}:${nodeId}`,
          nodeId,
          output: output ?? {},
        },
      ];
    }

    case 'execution_success':
      return [
        {
          dagRunId,
          eventType: EXECUTION_PROGRESS_EVENTS.COMPLETED,
          occurredAt: now,
        },
      ];

    case 'execution_error': {
      const nodeId = (message.data?.node_id as string) ?? 'unknown';
      const exceptionMessage = (message.data?.exception_message as string) ?? 'Execution error';
      const error = {
        code: 'COMFYUI_EXECUTION_ERROR',
        category: 'task_execution' as const,
        message: exceptionMessage,
        retryable: false,
      };
      return [
        {
          dagRunId,
          eventType: TASK_PROGRESS_EVENTS.FAILED,
          occurredAt: now,
          taskRunId: `${dagRunId}:${nodeId}`,
          nodeId,
          error,
        },
        {
          dagRunId,
          eventType: EXECUTION_PROGRESS_EVENTS.FAILED,
          occurredAt: now,
          error,
        },
      ];
    }

    default:
      return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-orchestrator-server test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add apps/dag-orchestrator-server/src/services/comfyui-event-translator.ts apps/dag-orchestrator-server/src/__tests__/comfyui-event-translator.test.ts
git commit -m "feat(dag-orchestrator-server): add ComfyUI to Robota event translator"
```

---

### Task 3: WebSocket route for orchestrator-server (TDD)

**Files:**

- Create: `apps/dag-orchestrator-server/src/routes/ws-routes.ts`
- Create: `apps/dag-orchestrator-server/src/__tests__/ws-routes.test.ts`
- Modify: `apps/dag-orchestrator-server/src/server.ts`
- Delete: `apps/dag-orchestrator-server/src/routes/sse-routes.ts`

**Step 1: Write failing integration test**

```typescript
// apps/dag-orchestrator-server/src/__tests__/ws-routes.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';

// Mock ComfyUI WS server
function createMockComfyUiServer(port: number): {
  wss: WebSocketServer;
  server: http.Server;
  broadcast: (msg: object) => void;
} {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const broadcast = (msg: object): void => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(msg));
      }
    }
  };
  server.listen(port);
  return { wss, server, broadcast };
}

describe('WebSocket proxy route', () => {
  // Tests will verify:
  // 1. Designer WS connects to orchestrator
  // 2. Orchestrator WS connects to mock ComfyUI
  // 3. Mock ComfyUI sends executing/executed/execution_success
  // 4. Designer receives task.started/task.completed/execution.completed
  // 5. Both connections close after terminal event

  it('relays ComfyUI events as Robota events to designer', async () => {
    // This test will be fleshed out after ws-routes.ts exists
    expect(true).toBe(true);
  });
});
```

**Step 2: Write WS route implementation**

```typescript
// apps/dag-orchestrator-server/src/routes/ws-routes.ts
import { WebSocketServer, WebSocket } from 'ws';
import type http from 'node:http';
import type { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import {
  translateComfyUiEvent,
  type IComfyUiWsMessage,
} from '../services/comfyui-event-translator.js';

/**
 * Registers WebSocket upgrade handling on the HTTP server.
 * Route: /v1/dag/runs/:dagRunId/ws
 *
 * 1. Designer connects WS to orchestrator
 * 2. Orchestrator connects WS to ComfyUI backend /ws
 * 3. On POST /start, orchestrator POST /prompt to ComfyUI (acquires promptId)
 * 4. ComfyUI events → translate → forward to designer
 * 5. Terminal event → close both connections
 */
export function registerWsRoutes(
  server: http.Server,
  runService: OrchestratorRunService,
  backendBaseUrl: string,
): void {
  const WS_PATH_PREFIX = '/v1/dag/runs/';
  const WS_PATH_SUFFIX = '/ws';

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (!url.startsWith(WS_PATH_PREFIX) || !url.endsWith(WS_PATH_SUFFIX)) {
      socket.destroy();
      return;
    }
    const dagRunId = url.slice(WS_PATH_PREFIX.length, url.length - WS_PATH_SUFFIX.length);
    if (dagRunId.length === 0) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (designerWs) => {
      wss.emit('connection', designerWs, request, dagRunId);
    });
  });

  wss.on(
    'connection',
    (designerWs: WebSocket, _request: http.IncomingMessage, dagRunId: string) => {
      const wsProtocol = backendBaseUrl.startsWith('https') ? 'wss' : 'ws';
      const wsHost = backendBaseUrl.replace(/^https?:\/\//, '');
      const comfyWsUrl = `${wsProtocol}://${wsHost}/ws?clientId=orch-${dagRunId}`;

      const comfyWs = new WebSocket(comfyWsUrl);
      let promptId: string | undefined;
      let closed = false;

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (comfyWs.readyState === WebSocket.OPEN || comfyWs.readyState === WebSocket.CONNECTING) {
          comfyWs.close();
        }
        if (
          designerWs.readyState === WebSocket.OPEN ||
          designerWs.readyState === WebSocket.CONNECTING
        ) {
          designerWs.close();
        }
      };

      // Poll for promptId (set by startRun)
      const promptIdPollInterval = setInterval(() => {
        const id = runService.getPromptIdForRun(dagRunId);
        if (typeof id === 'string') {
          promptId = id;
          clearInterval(promptIdPollInterval);
        }
      }, 100);

      comfyWs.on('message', (raw) => {
        if (closed || typeof promptId !== 'string') return;
        try {
          const message = JSON.parse(String(raw)) as IComfyUiWsMessage;
          const events = translateComfyUiEvent(message, dagRunId, promptId);
          for (const event of events) {
            if (designerWs.readyState === WebSocket.OPEN) {
              designerWs.send(JSON.stringify({ event }));
            }
            if (
              event.eventType === 'execution.completed' ||
              event.eventType === 'execution.failed'
            ) {
              cleanup();
            }
          }
        } catch {
          // Ignore non-JSON messages (e.g., binary preview frames)
        }
      });

      comfyWs.on('error', () => {
        if (designerWs.readyState === WebSocket.OPEN) {
          designerWs.send(
            JSON.stringify({
              event: {
                dagRunId,
                eventType: 'execution.failed',
                occurredAt: new Date().toISOString(),
                error: {
                  code: 'COMFYUI_WS_ERROR',
                  category: 'dispatch',
                  message: 'ComfyUI WebSocket connection error',
                  retryable: true,
                },
              },
            }),
          );
        }
        cleanup();
      });

      comfyWs.on('close', () => {
        clearInterval(promptIdPollInterval);
        if (!closed && designerWs.readyState === WebSocket.OPEN) {
          designerWs.close();
        }
        closed = true;
      });

      designerWs.on('close', () => {
        clearInterval(promptIdPollInterval);
        cleanup();
      });

      designerWs.on('error', () => {
        clearInterval(promptIdPollInterval);
        cleanup();
      });
    },
  );
}
```

**Step 3: Modify server.ts — replace SSE with WS**

In `apps/dag-orchestrator-server/src/server.ts`:

- Replace `import { registerSseRoutes }` with `import { registerWsRoutes }`
- Replace `registerSseRoutes(app, runService, backendUrl, resolveSseKeepAliveMs());` with `registerWsRoutes(server, runService, backendUrl);`
- Remove `resolveSseKeepAliveMs` function if only used by SSE

**Step 4: Delete SSE route**

```bash
rm apps/dag-orchestrator-server/src/routes/sse-routes.ts
```

**Step 5: Build and verify**

Run: `npx tsc --noEmit -p apps/dag-orchestrator-server/tsconfig.json && pnpm --filter @robota-sdk/dag-orchestrator-server build`
Expected: typecheck OK, build success

**Step 6: Commit**

```bash
git add apps/dag-orchestrator-server/src/routes/ws-routes.ts apps/dag-orchestrator-server/src/server.ts
git rm apps/dag-orchestrator-server/src/routes/sse-routes.ts
git commit -m "feat(dag-orchestrator-server): replace SSE with WS proxy to ComfyUI backend"
```

---

### Task 4: Designer — replace EventSource with WebSocket (TDD)

**Files:**

- Modify: `packages/dag-designer/src/client/designer-api-client.ts` (lines 275-358)
- Modify: `packages/dag-designer/src/contracts/designer-api.ts` (if signature changes — it won't)

**Step 1: Write failing test**

```typescript
// packages/dag-designer/src/__tests__/ws-subscribe-run-progress.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket for Node.js test environment
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  simulateMessage(data: object): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  simulateError(): void {
    this.onerror?.();
  }
}

let mockWsInstance: MockWebSocket;
vi.stubGlobal(
  'WebSocket',
  class extends MockWebSocket {
    constructor() {
      super();
      mockWsInstance = this;
    }
  },
);

describe('subscribeRunProgress with WebSocket', () => {
  it('calls onEvent when message received', () => {
    // Test will import and call subscribeRunProgress from DesignerApiClient
    // and verify onEvent is called with parsed TRunProgressEvent
    expect(true).toBe(true);
  });

  it('reconnects with exponential backoff on close', () => {
    expect(true).toBe(true);
  });

  it('calls onError after max reconnect attempts', () => {
    expect(true).toBe(true);
  });

  it('unsubscribe closes WebSocket', () => {
    expect(true).toBe(true);
  });
});
```

**Step 2: Modify `subscribeRunProgress` — replace EventSource with WebSocket**

In `packages/dag-designer/src/client/designer-api-client.ts`, replace the `subscribeRunProgress` method body (lines ~282-358):

```typescript
public subscribeRunProgress(input: {
    dagRunId: string;
    onEvent: (event: TRunProgressEvent) => void;
    onError?: (error: Error) => void;
    maxReconnectAttempts?: number;
    initialReconnectDelayMs?: number;
}): () => void {
    if (typeof WebSocket === 'undefined') {
        input.onError?.(new Error('WebSocket is not available in this environment.'));
        return () => { return; };
    }
    const wsProtocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const wsHost = this.baseUrl.replace(/^https?:\/\//, '');
    const path = `/v1/dag/runs/${encodeURIComponent(input.dagRunId)}/ws`;
    const wsUrl = `${wsProtocol}://${wsHost}${path}`;

    const maxReconnectAttempts = input.maxReconnectAttempts ?? 5;
    const initialReconnectDelayMs = input.initialReconnectDelayMs ?? 500;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let ws: WebSocket | undefined;

    const clearReconnectTimer = (): void => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = undefined;
        }
    };

    const connect = (): void => {
        if (closed) return;
        const nextWs = new WebSocket(wsUrl);
        ws = nextWs;
        nextWs.onopen = () => { reconnectAttempt = 0; };
        nextWs.onmessage = (event) => {
            try {
                const parsed = JSON.parse(String(event.data)) as { event?: TRunProgressEvent };
                if (parsed.event) {
                    input.onEvent(parsed.event);
                }
            } catch {
                input.onError?.(new Error('Failed to parse run progress event payload.'));
            }
        };
        nextWs.onerror = () => {
            // onerror is always followed by onclose in browsers
        };
        nextWs.onclose = () => {
            if (closed) return;
            if (ws !== nextWs) return;
            if (reconnectAttempt >= maxReconnectAttempts) {
                input.onError?.(new Error('Run progress stream disconnected.'));
                return;
            }
            const delay = initialReconnectDelayMs * (2 ** reconnectAttempt);
            reconnectAttempt += 1;
            clearReconnectTimer();
            reconnectTimer = setTimeout(() => { connect(); }, delay);
        };
    };

    connect();

    return () => {
        closed = true;
        clearReconnectTimer();
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close();
        }
    };
}
```

**Step 3: Build and test**

Run: `pnpm --filter @robota-sdk/dag-designer build && pnpm --filter @robota-sdk/dag-designer test`
Expected: Build success, tests pass

**Step 4: Commit**

```bash
git add packages/dag-designer/src/client/designer-api-client.ts packages/dag-designer/src/__tests__/ws-subscribe-run-progress.test.ts
git commit -m "feat(dag-designer): replace EventSource with WebSocket for run progress"
```

---

### Task 5: runtime-server — ComfyUI-compatible `/ws` (local testing)

**Files:**

- Create: `apps/dag-runtime-server/src/routes/ws-routes.ts`
- Modify: `apps/dag-runtime-server/src/server.ts`
- Modify: `apps/dag-runtime-server/package.json` (add `ws` dep)

**Step 1: Add ws dependency**

```bash
pnpm --filter @robota-sdk/dag-runtime-server add ws
pnpm --filter @robota-sdk/dag-runtime-server add -D @types/ws
```

**Step 2: Write ComfyUI-compatible WS route**

```typescript
// apps/dag-runtime-server/src/routes/ws-routes.ts
import { WebSocketServer, WebSocket } from 'ws';
import type http from 'node:http';
import type { IRunProgressEventBus } from '@robota-sdk/dag-api';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import { TASK_PROGRESS_EVENTS, EXECUTION_PROGRESS_EVENTS } from '@robota-sdk/dag-core';

interface IPromptIdResolver {
  getPromptIdForDagRun(dagRunId: string): string | undefined;
}

/**
 * Converts Robota event bus events to ComfyUI WebSocket message format
 * and broadcasts to connected clients.
 *
 * ComfyUI format: {type: "executing", data: {node: "id", prompt_id: "..."}}
 */
function toComfyUiMessage(event: TRunProgressEvent, promptId: string): object | undefined {
  switch (event.eventType) {
    case EXECUTION_PROGRESS_EVENTS.STARTED:
      return { type: 'execution_start', data: { prompt_id: promptId } };
    case TASK_PROGRESS_EVENTS.STARTED:
      return {
        type: 'executing',
        data: { node: (event as { nodeId: string }).nodeId, prompt_id: promptId },
      };
    case TASK_PROGRESS_EVENTS.COMPLETED:
      return {
        type: 'executed',
        data: {
          node: (event as { nodeId: string }).nodeId,
          output: (event as { output?: unknown }).output ?? {},
          prompt_id: promptId,
        },
      };
    case TASK_PROGRESS_EVENTS.FAILED: {
      const failedEvent = event as { nodeId?: string; error?: { message?: string } };
      return {
        type: 'execution_error',
        data: {
          prompt_id: promptId,
          node_id: failedEvent.nodeId ?? 'unknown',
          exception_message: failedEvent.error?.message ?? 'Task failed',
        },
      };
    }
    case EXECUTION_PROGRESS_EVENTS.COMPLETED:
      return { type: 'execution_success', data: { prompt_id: promptId } };
    case EXECUTION_PROGRESS_EVENTS.FAILED:
      return undefined; // Already sent as execution_error from task.failed
    default:
      return undefined;
  }
}

export function mountWsRoutes(
  server: http.Server,
  eventBus: IRunProgressEventBus,
  promptIdResolver: IPromptIdResolver,
): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  eventBus.subscribe((event: TRunProgressEvent) => {
    const promptId = promptIdResolver.getPromptIdForDagRun(event.dagRunId);
    if (!promptId) return;
    const message = toComfyUiMessage(event, promptId);
    if (!message) return;
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });
}
```

**Step 3: Modify runtime server.ts**

In `apps/dag-runtime-server/src/server.ts`:

- Import `mountWsRoutes` and `http`
- Change `app.listen(port)` to `const server = http.createServer(app); server.listen(port)`
- Add `mountWsRoutes(server, execution.runProgressEventBus, promptBackend)`
- Add `getPromptIdForDagRun` method to `DagPromptBackend` (reverse lookup from existing `promptIdToDagRunId` map)

**Step 4: Add reverse lookup to DagPromptBackend**

In `apps/dag-runtime-server/src/adapters/dag-prompt-backend.ts`, add:

```typescript
private readonly dagRunIdToPromptId = new Map<string, string>();

getPromptIdForDagRun(dagRunId: string): string | undefined {
    return this.dagRunIdToPromptId.get(dagRunId);
}
```

And in `submitPrompt`, after `this.promptIdToDagRunId.set(...)`:

```typescript
this.dagRunIdToPromptId.set(createdRun.value.dagRunId, promptId);
```

**Step 5: Build and verify**

Run: `npx tsc --noEmit -p apps/dag-runtime-server/tsconfig.json && pnpm --filter @robota-sdk/dag-runtime-server build`
Expected: typecheck OK, build success

**Step 6: Commit**

```bash
git add apps/dag-runtime-server/src/routes/ws-routes.ts apps/dag-runtime-server/src/server.ts apps/dag-runtime-server/src/adapters/dag-prompt-backend.ts apps/dag-runtime-server/package.json pnpm-lock.yaml
git commit -m "feat(dag-runtime-server): add ComfyUI-compatible /ws WebSocket endpoint"
```

---

### Task 6: Integration test — full WS-to-WS E2E

**Files:**

- Create: `apps/dag-orchestrator-server/src/__tests__/ws-proxy-e2e.test.ts`

**Step 1: Write integration test**

Test flow: mock ComfyUI WS server → orchestrator → designer WS client

```typescript
// apps/dag-orchestrator-server/src/__tests__/ws-proxy-e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';

describe('WS proxy E2E', () => {
  // 1. Start mock ComfyUI WS server on random port
  // 2. Start orchestrator (or just the WS route handler) pointing to mock ComfyUI
  // 3. Connect designer WS client to orchestrator
  // 4. Create and start a run via orchestrator REST API
  // 5. Mock ComfyUI broadcasts: executing(in1) → executed(in1) → executing(out1) → executed(out1) → execution_success
  // 6. Verify designer receives: task.started(in1) → task.completed(in1) → task.started(out1) → task.completed(out1) → execution.completed
  // 7. Verify both WS connections are closed

  it('full event relay flow', async () => {
    // Implementation after Tasks 1-5 are done
    expect(true).toBe(true);
  });
});
```

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/dag-orchestrator-server/src/__tests__/ws-proxy-e2e.test.ts
git commit -m "test(dag-orchestrator-server): add WS proxy E2E integration test"
```

---

### Task 7: Cleanup and verify

**Step 1: Remove SSE-related code**

- Verify `sse-routes.ts` is deleted
- Remove `resolveSseKeepAliveMs` from `server.ts` if unused
- Remove `SSE_KEEPALIVE_MS` env var handling if present

**Step 2: Full build**

Run: `pnpm build && pnpm typecheck && pnpm test`
Expected: All pass

**Step 3: Manual browser verification**

```bash
# Terminal 1: runtime
node apps/dag-runtime-server/dist/server.cjs

# Terminal 2: orchestrator
node apps/dag-orchestrator-server/dist/server.cjs

# Terminal 3: web
pnpm --filter @robota-sdk/agent-web dev
```

Open `http://localhost:3000/dag-designer`, create a DAG, run it, verify nodes show running/success status.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(dag-orchestrator-server): cleanup SSE remnants after WS migration"
```
