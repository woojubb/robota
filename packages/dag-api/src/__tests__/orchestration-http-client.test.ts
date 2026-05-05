import { describe, expect, it } from 'vitest';
import { DagOrchestrationHttpClient } from '../orchestration-http-client.js';

const TEST_SERVER_URL = 'http://127.0.0.1:3012';

interface ICapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

interface IFakePayload {
  readonly ok?: boolean;
  readonly status?: number;
  readonly data?: object;
  readonly errors?: readonly object[];
}

function createClient(responses: readonly IFakePayload[]): {
  readonly client: DagOrchestrationHttpClient;
  readonly requests: ICapturedRequest[];
} {
  const requests: ICapturedRequest[] = [];
  let responseIndex = 0;
  const client = new DagOrchestrationHttpClient({
    baseUrl: `${TEST_SERVER_URL}/`,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      const payload = responses[responseIndex] ?? { ok: true, status: 200 };
      responseIndex += 1;
      return new Response(JSON.stringify(payload), {
        status: payload.ok === false ? 400 : 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, requests };
}

function createDefinition() {
  return {
    dagId: 'demo dag',
    version: 1,
    status: 'draft' as const,
    nodes: [],
    edges: [],
  };
}

describe('DagOrchestrationHttpClient', () => {
  it('lists definitions with encoded dagId query', async () => {
    const { client, requests } = createClient([{ ok: true, status: 200, data: { items: [] } }]);

    const result = await client.listDefinitions({ dagId: 'demo dag' });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/definitions?dagId=demo%20dag`);
    expect(requests[0]?.init.method).toBe('GET');
  });

  it('updates draft definitions through the shared API route contract', async () => {
    const definition = createDefinition();
    const { client, requests } = createClient([{ ok: true, status: 200, data: { definition } }]);

    const result = await client.updateDraft({
      dagId: definition.dagId,
      version: definition.version,
      definition,
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/definitions/demo%20dag/draft`);
    expect(requests[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      version: 1,
      definition,
    });
  });

  it('creates partial runs without duplicating client code in downstream packages', async () => {
    const definition = createDefinition();
    const { client, requests } = createClient([
      { ok: true, status: 201, data: { preparationId: 'prep-1' } },
    ]);

    const result = await client.createRun({
      definition,
      input: { prompt: 'hello' },
      partialRun: { startNodeId: 'node-a' },
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/runs`);
    expect(requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      definition,
      input: { prompt: 'hello' },
      partialRun: { startNodeId: 'node-a' },
    });
  });
});
