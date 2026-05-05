import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  IDagDefinition,
  IDagError,
  IPromptRequest,
  IPromptResponse,
  IQueueAction,
  IQueueStatus,
  ISystemStats,
  THistory,
  TObjectInfo,
  TResult,
  TRunProgressEvent,
} from '@robota-sdk/dag-core';
import { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import type { IPromptApiClientPort } from '@robota-sdk/dag-orchestrator';
import { registerWsRoutes } from '../routes/ws-routes.js';

const TEST_TIMEOUT_MS = 2500;
const BUFFER_CHECK_DELAY_MS = 150;

interface IRunProgressEnvelope {
  event: TRunProgressEvent;
}

interface IBackendHarness {
  readonly baseUrl: string;
  readonly wss: WebSocketServer;
  readonly connections: Set<WebSocket>;
  close: () => Promise<void>;
}

interface IOrchestratorHarness {
  readonly wsBaseUrl: string;
  close: () => Promise<void>;
}

class StubPromptApiClient implements IPromptApiClientPort {
  constructor(private nextPromptId: string) {}

  setNextPromptId(promptId: string): void {
    this.nextPromptId = promptId;
  }

  async submitPrompt(_request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> {
    return {
      ok: true,
      value: {
        prompt_id: this.nextPromptId,
        number: 1,
        node_errors: {},
      },
    };
  }

  async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
    return { ok: true, value: { queue_running: [], queue_pending: [] } };
  }

  async manageQueue(_action: IQueueAction): Promise<TResult<void, IDagError>> {
    return { ok: true, value: undefined };
  }

  async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
    if (typeof promptId !== 'string') {
      return { ok: true, value: {} };
    }

    return {
      ok: true,
      value: {
        [promptId]: {
          prompt: {},
          outputs: {},
          status: { status_str: 'success', completed: true, messages: [] },
        },
      },
    };
  }

  async getObjectInfo(): Promise<TResult<TObjectInfo, IDagError>> {
    return { ok: true, value: {} };
  }

  async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
    return {
      ok: true,
      value: {
        system: { os: 'test', runtime_version: 'test', embedded_python: false },
        devices: [],
      },
    };
  }
}

class RecordingRunService extends OrchestratorRunService {
  readonly recordedEvents: Array<{ dagRunId: string; event: TRunProgressEvent }> = [];

  override recordEvent(dagRunId: string, event: TRunProgressEvent): void {
    this.recordedEvents.push({ dagRunId, event });
    super.recordEvent(dagRunId, event);
  }
}

function createMinimalDefinition(): IDagDefinition {
  return {
    dagId: 'ws-test-dag',
    version: 1,
    status: 'draft',
    nodes: [
      {
        nodeId: '1',
        nodeType: 'text-template',
        config: { template: 'hello' },
      },
    ],
    edges: [],
  };
}

function getPort(server: http.Server): number {
  const address = server.address() as AddressInfo | null;
  if (address === null) {
    throw new Error('Server did not bind to a port');
  }
  return address.port;
}

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startBackend(): Promise<IBackendHarness> {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const connections = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    connections.add(ws);
    ws.on('close', () => {
      connections.delete(ws);
    });
  });

  await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${getPort(server)}`,
    wss,
    connections,
    close: async () => {
      for (const ws of connections) {
        ws.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
      await closeServer(server);
    },
  };
}

async function startOrchestrator(
  runService: OrchestratorRunService,
  backendBaseUrl: string,
): Promise<IOrchestratorHarness> {
  const server = http.createServer();
  registerWsRoutes(server, runService, backendBaseUrl);
  await listen(server);

  return {
    wsBaseUrl: `ws://127.0.0.1:${getPort(server)}`,
    close: async () => {
      await closeServer(server);
    },
  };
}

function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket open'));
    }, TEST_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('error', onError);
    };
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    ws.once('open', onOpen);
    ws.once('error', onError);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket close'));
    }, TEST_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off('close', onClose);
      ws.off('error', onError);
    };
    const onClose = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    ws.once('close', onClose);
    ws.once('error', onError);
  });
}

function waitForBackendConnection(backend: IBackendHarness): Promise<WebSocket> {
  const openConnection = Array.from(backend.connections).find(
    (ws) => ws.readyState === WebSocket.OPEN,
  );
  if (openConnection) return Promise.resolve(openConnection);

  return new Promise<WebSocket>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for backend WebSocket connection'));
    }, TEST_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      backend.wss.off('connection', onConnection);
    };
    const onConnection = (ws: WebSocket): void => {
      cleanup();
      resolve(ws);
    };
    backend.wss.once('connection', onConnection);
  });
}

function rawDataToText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf-8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf-8');
  return data.toString('utf-8');
}

function waitForEnvelope(ws: WebSocket): Promise<IRunProgressEnvelope> {
  return new Promise<IRunProgressEnvelope>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for run progress envelope'));
    }, TEST_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    const onMessage = (data: RawData): void => {
      cleanup();
      resolve(JSON.parse(rawDataToText(data)) as IRunProgressEnvelope);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function expectPending<T>(promise: Promise<T>, ms: number): Promise<void> {
  const result = await Promise.race([
    promise.then(() => 'settled' as const),
    delay(ms).then(() => 'pending' as const),
  ]);
  expect(result).toBe('pending');
}

async function createPendingRun(runService: RecordingRunService): Promise<string> {
  const result = await runService.createRun(createMinimalDefinition(), {});
  if (!result.ok) throw new Error(result.error.message);
  return result.value.preparationId;
}

async function startPreparedRun(
  runService: RecordingRunService,
  preparationId: string,
): Promise<string> {
  const result = await runService.startRun(preparationId);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.dagRunId;
}

function comfyMessage(type: string, promptId: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type,
    data: { ...data, prompt_id: promptId },
  });
}

describe('run progress WebSocket route contracts', () => {
  it('forwards progress events using the route event envelope for a post-start dagRunId URL', async () => {
    const promptClient = new StubPromptApiClient('prompt-success');
    const runService = new RecordingRunService(promptClient);
    const preparationId = await createPendingRun(runService);
    const dagRunId = await startPreparedRun(runService, preparationId);
    const backend = await startBackend();
    const orchestrator = await startOrchestrator(runService, backend.baseUrl);

    try {
      const backendConnection = waitForBackendConnection(backend);
      const designer = new WebSocket(`${orchestrator.wsBaseUrl}/v1/dag/runs/${dagRunId}/ws`);
      await waitForOpen(designer);
      const comfyWs = await backendConnection;
      const envelopePromise = waitForEnvelope(designer);

      comfyWs.send(comfyMessage('executing', dagRunId, { node: 'node-1' }));

      const envelope = await envelopePromise;
      expect(envelope.event).toEqual(
        expect.objectContaining({
          dagRunId,
          eventType: 'task.started',
          nodeId: 'node-1',
          taskRunId: `${dagRunId}:node-1`,
        }),
      );
      expect(runService.recordedEvents).toHaveLength(1);
      expect(runService.recordedEvents[0].event).toEqual(envelope.event);
      designer.close();
      await waitForClose(designer);
    } finally {
      await orchestrator.close();
      await backend.close();
    }
  });

  it('buffers backend messages until the preparation resolves to a dagRunId', async () => {
    const promptClient = new StubPromptApiClient('prompt-buffered');
    const runService = new RecordingRunService(promptClient);
    const preparationId = await createPendingRun(runService);
    const backend = await startBackend();
    const orchestrator = await startOrchestrator(runService, backend.baseUrl);

    try {
      const backendConnection = waitForBackendConnection(backend);
      const designer = new WebSocket(`${orchestrator.wsBaseUrl}/v1/dag/runs/${preparationId}/ws`);
      await waitForOpen(designer);
      const comfyWs = await backendConnection;
      const envelopePromise = waitForEnvelope(designer);

      comfyWs.send(comfyMessage('executing', 'prompt-buffered', { node: 'node-2' }));
      await expectPending(envelopePromise, BUFFER_CHECK_DELAY_MS);

      const dagRunId = await startPreparedRun(runService, preparationId);
      const envelope = await envelopePromise;

      expect(dagRunId).toBe('prompt-buffered');
      expect(envelope.event).toEqual(
        expect.objectContaining({
          dagRunId,
          eventType: 'task.started',
          nodeId: 'node-2',
          taskRunId: `${dagRunId}:node-2`,
        }),
      );
      expect(runService.recordedEvents).toHaveLength(1);
      designer.close();
      await waitForClose(designer);
    } finally {
      await orchestrator.close();
      await backend.close();
    }
  });

  it('cleans up both bridge sockets after a terminal event', async () => {
    const promptClient = new StubPromptApiClient('prompt-terminal');
    const runService = new RecordingRunService(promptClient);
    const preparationId = await createPendingRun(runService);
    const dagRunId = await startPreparedRun(runService, preparationId);
    const backend = await startBackend();
    const orchestrator = await startOrchestrator(runService, backend.baseUrl);

    try {
      const backendConnection = waitForBackendConnection(backend);
      const designer = new WebSocket(`${orchestrator.wsBaseUrl}/v1/dag/runs/${preparationId}/ws`);
      await waitForOpen(designer);
      const comfyWs = await backendConnection;
      const envelopePromise = waitForEnvelope(designer);

      comfyWs.send(comfyMessage('execution_success', dagRunId));

      const envelope = await envelopePromise;
      expect(envelope.event).toEqual(
        expect.objectContaining({
          dagRunId,
          eventType: 'execution.completed',
        }),
      );
      await waitForClose(designer);
      await waitForClose(comfyWs);
    } finally {
      await orchestrator.close();
      await backend.close();
    }
  });

  it('forwards backend connection failures as terminal failed events', async () => {
    const promptClient = new StubPromptApiClient('prompt-unused');
    const runService = new RecordingRunService(promptClient);
    const orchestrator = await startOrchestrator(runService, 'http://127.0.0.1:1');

    try {
      const designer = new WebSocket(`${orchestrator.wsBaseUrl}/v1/dag/runs/prep-failed/ws`);
      await waitForOpen(designer);
      const envelope = await waitForEnvelope(designer);

      expect(envelope.event).toEqual(
        expect.objectContaining({
          dagRunId: 'prep-failed',
          eventType: 'execution.failed',
          error: expect.objectContaining({
            code: 'WS_BRIDGE_ERROR',
            category: 'task_execution',
            retryable: false,
          }),
        }),
      );
      await waitForClose(designer);
    } finally {
      await orchestrator.close();
    }
  });
});
