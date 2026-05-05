import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import type { IDagOrchestrationRunDraftSuccessPayload } from '@robota-sdk/dag-orchestration-client';
import type { IDagDefinition, IRunDraft } from '@robota-sdk/dag-core';
import { InMemoryRunDraftStore } from '@robota-sdk/dag-adapters-local';
import { registerRunDraftRoutes } from '../routes/run-draft-routes.js';

function createDefinition(): IDagDefinition {
  return {
    dagId: 'draft-dag',
    version: 1,
    status: 'draft',
    nodes: [
      {
        nodeId: 'source',
        nodeType: 'input',
        dependsOn: [],
        config: {},
      },
      {
        nodeId: 'output',
        nodeType: 'text-output',
        dependsOn: ['source'],
        config: {},
      },
      {
        nodeId: 'side',
        nodeType: 'text-output',
        dependsOn: [],
        config: {},
      },
    ],
    edges: [
      {
        from: 'source',
        to: 'output',
        bindings: [{ outputKey: 'text', inputKey: 'text' }],
      },
    ],
  };
}

function createDraft(): IRunDraft {
  return {
    draftId: 'draft-1',
    definition: createDefinition(),
    input: { prompt: 'hello' },
    nodeStateMap: {
      source: {
        operationStatus: 'idle',
        executionStatus: 'success',
        trace: { nodeId: 'source', output: { text: 'hello' } },
      },
      output: {
        operationStatus: 'idle',
        executionStatus: 'success',
        trace: { nodeId: 'output', output: { text: 'hello' } },
      },
      side: {
        operationStatus: 'idle',
        executionStatus: 'success',
        trace: { nodeId: 'side', output: { text: 'side' } },
      },
    },
    runResult: {
      dagRunId: 'run-1',
      status: 'failed',
      traces: [
        {
          nodeId: 'source',
          nodeType: 'input',
          input: {},
          output: { text: 'hello' },
          estimatedCredits: 0,
          totalCredits: 0,
        },
        {
          nodeId: 'output',
          nodeType: 'text-output',
          input: { text: 'hello' },
          output: { text: 'hello' },
          estimatedCredits: 0,
          totalCredits: 0,
        },
        {
          nodeId: 'side',
          nodeType: 'text-output',
          input: {},
          output: { text: 'side' },
          estimatedCredits: 0,
          totalCredits: 0,
        },
      ],
      nodeErrors: [
        {
          nodeId: 'output',
          nodeType: 'text-output',
          occurredAt: '2026-05-05T00:00:00.000Z',
          error: {
            code: 'NODE_FAILED',
            category: 'task_execution',
            message: 'Node failed',
            retryable: false,
          },
        },
      ],
      totalCredits: 0,
    },
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:01.000Z',
  };
}

let app: express.Express;
let store: InMemoryRunDraftStore;

async function request(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Server did not bind to a port');
  }
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: typeof payload === 'undefined' ? undefined : JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('run draft routes', () => {
  beforeEach(() => {
    app = express();
    app.use(express.json());
    store = new InMemoryRunDraftStore();
    registerRunDraftRoutes(app, store);
  });

  it('creates and restores an execution draft', async () => {
    const createResult = await request('POST', '/v1/dag/run-drafts', {
      draftId: 'draft-1',
      definition: createDefinition(),
      input: { prompt: 'hello' },
    });

    expect(createResult.status).toBe(201);
    const created = createResult.body as IDagOrchestrationRunDraftSuccessPayload;
    expect(created.data.draft.draftId).toBe('draft-1');
    expect(created.data.draft.definition.dagId).toBe('draft-dag');
    expect(created.data.draft.nodeStateMap.source.executionStatus).toBe('idle');

    const getResult = await request('GET', '/v1/dag/run-drafts/draft-1');
    expect(getResult.status).toBe(200);
    const restored = getResult.body as IDagOrchestrationRunDraftSuccessPayload;
    expect(restored.data.draft.input).toEqual({ prompt: 'hello' });
  });

  it('resets node and downstream result state', async () => {
    await store.saveRunDraft(createDraft());

    const result = await request('PUT', '/v1/dag/run-drafts/draft-1/nodes/source/reset');

    expect(result.status).toBe(200);
    const envelope = result.body as IDagOrchestrationRunDraftSuccessPayload;
    expect(envelope.data.draft.nodeStateMap.source.executionStatus).toBe('idle');
    expect(envelope.data.draft.nodeStateMap.output.executionStatus).toBe('idle');
    expect(envelope.data.draft.nodeStateMap.side.executionStatus).toBe('success');
    expect(envelope.data.draft.runResult?.traces.map((trace) => trace.nodeId)).toEqual(['side']);
  });

  it('overwrites one node result', async () => {
    await store.saveRunDraft(createDraft());

    const result = await request('PUT', '/v1/dag/run-drafts/draft-1/nodes/source/result', {
      input: { prompt: 'manual' },
      output: { text: 'manual result' },
    });

    expect(result.status).toBe(200);
    const envelope = result.body as IDagOrchestrationRunDraftSuccessPayload;
    expect(envelope.data.draft.nodeStateMap.source.executionStatus).toBe('success');
    expect(envelope.data.draft.nodeStateMap.source.trace?.output).toEqual({
      text: 'manual result',
    });
    expect(
      envelope.data.draft.runResult?.traces.find((trace) => trace.nodeId === 'source')?.output,
    ).toEqual({ text: 'manual result' });
  });

  it('returns 404 for unknown draft', async () => {
    const result = await request('GET', '/v1/dag/run-drafts/missing');

    expect(result.status).toBe(404);
    const envelope = result.body as { ok: false; errors: Array<{ code: string }> };
    expect(envelope.errors[0].code).toBe('DAG_RUN_DRAFT_NOT_FOUND');
  });
});
