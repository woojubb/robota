import { describe, expect, it } from 'vitest';
import type { IDagCliRunOptions } from '../runner.js';
import { runDagCli } from '../runner.js';

const TEST_SERVER_URL = 'http://127.0.0.1:3012';

interface ICapturedRequest {
  url: string;
  init: RequestInit;
}

interface IFakeResponsePayload {
  ok?: boolean;
  status?: number;
  data?: object;
  errors?: object[];
}

function createDefinition() {
  return {
    dagId: 'demo',
    version: 1,
    status: 'draft' as const,
    nodes: [],
    edges: [],
    metadata: {},
  };
}

function createOptions(responses: readonly IFakeResponsePayload[]): IDagCliRunOptions & {
  readonly requests: ICapturedRequest[];
  readonly output: string[];
} {
  const requests: ICapturedRequest[] = [];
  const output: string[] = [];
  let responseIndex = 0;
  return {
    env: { ROBOTA_DAG_SERVER_URL: TEST_SERVER_URL },
    io: {
      write: (text) => {
        output.push(text);
      },
      readTextFile: async (filePath) => {
        if (filePath === 'definition.json') {
          return JSON.stringify(createDefinition());
        }
        if (filePath === 'input.json') {
          return JSON.stringify({ prompt: 'hello' });
        }
        return '{}';
      },
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      const response = responses[responseIndex] ?? { ok: true, status: 200 };
      responseIndex += 1;
      return new Response(JSON.stringify(response), {
        status: typeof response.ok === 'boolean' && response.ok ? 200 : 400,
        headers: { 'content-type': 'application/json' },
      });
    },
    requests,
    output,
  };
}

describe('runDagCli', () => {
  it('lists definitions from configured orchestrator server', async () => {
    const options = createOptions([{ ok: true, status: 200, data: { items: [] } }]);

    const exitCode = await runDagCli(['definitions', 'list'], options);

    expect(exitCode).toBe(0);
    expect(options.requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/definitions`);
    expect(options.requests[0]?.init.method).toBe('GET');
    expect(JSON.parse(options.output.join(''))).toEqual({
      ok: true,
      status: 200,
      data: { items: [] },
    });
  });

  it('creates a definition from a JSON file', async () => {
    const definition = createDefinition();
    const options = createOptions([{ ok: true, status: 201, data: { definition } }]);

    const exitCode = await runDagCli(
      ['definitions', 'create', '--file', 'definition.json'],
      options,
    );

    expect(exitCode).toBe(0);
    expect(options.requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/definitions`);
    expect(options.requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(options.requests[0]?.init.body))).toEqual({ definition });
  });

  it('creates a partial run with input JSON loaded from a file reference', async () => {
    const options = createOptions([{ ok: true, status: 201, data: { preparationId: 'prep-1' } }]);

    const exitCode = await runDagCli(
      [
        'runs',
        'create',
        '--file',
        'definition.json',
        '--input',
        '@input.json',
        '--partial-start',
        'node-a',
      ],
      options,
    );

    expect(exitCode).toBe(0);
    expect(options.requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/runs`);
    expect(options.requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(options.requests[0]?.init.body))).toEqual({
      definition: createDefinition(),
      input: { prompt: 'hello' },
      partialRun: { startNodeId: 'node-a' },
    });
  });

  it('returns usage errors as JSON without calling the server', async () => {
    const options = createOptions([]);

    const exitCode = await runDagCli(['runs', 'start'], options);

    expect(exitCode).toBe(2);
    expect(options.requests).toHaveLength(0);
    expect(JSON.parse(options.output.join(''))).toMatchObject({
      ok: false,
      status: 2,
      errors: [{ code: 'DAG_CLI_USAGE_ERROR' }],
    });
  });
});
