import { describe, expect, it } from 'vitest';
import type { ICostMeta } from '@robota-sdk/dag-cost';
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
        status: payload.status ?? (payload.ok === false ? 400 : 200),
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, requests };
}

function createCostMeta(nodeType = 'llm text openai'): ICostMeta {
  return {
    nodeType,
    displayName: 'LLM Text OpenAI',
    category: 'ai-inference',
    estimateFormula: 'tokenCount * rate',
    variables: { rate: 0.01, tokenCount: 100 },
    enabled: true,
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
}

describe('DagOrchestrationHttpClient cost meta endpoints', () => {
  it('calls cost meta CRUD endpoints through package-owned HTTP contracts', async () => {
    const meta = createCostMeta();
    const { client, requests } = createClient([
      { ok: true, status: 200, data: { items: [meta] } },
      { ok: true, status: 200, data: { meta } },
      { ok: true, status: 201, data: { meta } },
      { ok: true, status: 200, data: { meta } },
      { ok: true, status: 200, data: { nodeType: meta.nodeType } },
    ]);

    await client.listCostMeta();
    await client.getCostMeta(meta.nodeType);
    await client.createCostMeta(meta);
    await client.updateCostMeta(meta.nodeType, meta);
    await client.deleteCostMeta(meta.nodeType);

    expect(requests.map((request) => request.url)).toEqual([
      `${TEST_SERVER_URL}/v1/cost-meta`,
      `${TEST_SERVER_URL}/v1/cost-meta/llm%20text%20openai`,
      `${TEST_SERVER_URL}/v1/cost-meta`,
      `${TEST_SERVER_URL}/v1/cost-meta/llm%20text%20openai`,
      `${TEST_SERVER_URL}/v1/cost-meta/llm%20text%20openai`,
    ]);
    expect(requests.map((request) => request.init.method)).toEqual([
      'GET',
      'GET',
      'POST',
      'PUT',
      'DELETE',
    ]);
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual(meta);
    expect(JSON.parse(String(requests[3]?.init.body))).toEqual(meta);
  });

  it('calls cost meta formula validation and preview endpoints', async () => {
    const { client, requests } = createClient([
      { ok: true, status: 200, data: { valid: true, errors: [] } },
      { ok: true, status: 200, data: { result: 18 } },
    ]);

    await client.validateCostMetaFormula({ formula: 'a + b' });
    const previewResult = await client.previewCostMetaFormula({
      formula: 'baseCost + duration * perSec',
      variables: { baseCost: 8, perSec: 1 },
      testContext: { duration: 10 },
    });

    expect(previewResult.ok).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      `${TEST_SERVER_URL}/v1/cost-meta/validate`,
      `${TEST_SERVER_URL}/v1/cost-meta/preview`,
    ]);
    expect(requests.map((request) => request.init.method)).toEqual(['POST', 'POST']);
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ formula: 'a + b' });
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      formula: 'baseCost + duration * perSec',
      variables: { baseCost: 8, perSec: 1 },
      testContext: { duration: 10 },
    });
  });
});
