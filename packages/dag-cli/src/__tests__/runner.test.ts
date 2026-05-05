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

function createRunDraftInput() {
  return {
    draftId: 'draft-1',
    definition: createDefinition(),
    input: { prompt: 'hello' },
  };
}

function createNodeResultInput() {
  return {
    input: { prompt: 'hello' },
    output: { text: 'done' },
  };
}

function createPublishedWorkflowRequest() {
  return {
    input: { prompt: 'hello' },
    overrides: {
      source: {
        template: 'override prompt',
      },
    },
  };
}

function createAssetUploadRequest() {
  return {
    fileName: 'photo.png',
    mediaType: 'image/png',
    base64Data: 'AQIDBA==',
  };
}

function createOptions(responses: readonly IFakeResponsePayload[]): IDagCliRunOptions & {
  readonly requests: ICapturedRequest[];
  readonly output: string[];
  readonly binaryWrites: Array<{ readonly filePath: string; readonly bytes: Uint8Array }>;
} {
  const requests: ICapturedRequest[] = [];
  const output: string[] = [];
  const binaryWrites: Array<{ readonly filePath: string; readonly bytes: Uint8Array }> = [];
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
        if (filePath === 'draft.json') {
          return JSON.stringify(createRunDraftInput());
        }
        if (filePath === 'input.json') {
          return JSON.stringify({ prompt: 'hello' });
        }
        if (filePath === 'node-result.json') {
          return JSON.stringify(createNodeResultInput());
        }
        if (filePath === 'workflow-run.json') {
          return JSON.stringify(createPublishedWorkflowRequest());
        }
        if (filePath === 'asset.json') {
          return JSON.stringify(createAssetUploadRequest());
        }
        return '{}';
      },
      writeBinaryStream: async (filePath, stream) => {
        const chunks: Uint8Array[] = [];
        const reader = stream.getReader();
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          chunks.push(result.value);
        }
        const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        binaryWrites.push({ filePath, bytes });
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
    binaryWrites,
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

  it('routes run draft commands through shared HTTP contracts', async () => {
    const options = createOptions([
      { ok: true, status: 201, data: { draft: createRunDraftInput() } },
      { ok: true, status: 200, data: { draft: createRunDraftInput() } },
      { ok: true, status: 200, data: { draft: createRunDraftInput() } },
      { ok: true, status: 200, data: { draft: createRunDraftInput() } },
      { ok: true, status: 200, data: { draft: createRunDraftInput() } },
    ]);

    const createExit = await runDagCli(['run-drafts', 'create', '--json', '@draft.json'], options);
    const getExit = await runDagCli(['run-drafts', 'get', 'draft 1'], options);
    const replaceExit = await runDagCli(
      ['run-drafts', 'replace', 'draft 1', '--json', '@draft.json'],
      options,
    );
    const resetExit = await runDagCli(['run-drafts', 'reset', 'draft 1', 'source node'], options);
    const overwriteExit = await runDagCli(
      ['run-drafts', 'overwrite', 'draft 1', 'source node', '--json', '@node-result.json'],
      options,
    );

    expect([createExit, getExit, replaceExit, resetExit, overwriteExit]).toEqual([0, 0, 0, 0, 0]);
    expect(options.requests.map((request) => [request.init.method, request.url])).toEqual([
      ['POST', `${TEST_SERVER_URL}/v1/dag/run-drafts`],
      ['GET', `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201`],
      ['PUT', `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201`],
      ['PUT', `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201/nodes/source%20node/reset`],
      ['PUT', `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201/nodes/source%20node/result`],
    ]);
    expect(JSON.parse(String(options.requests[0]?.init.body))).toEqual(createRunDraftInput());
    expect(JSON.parse(String(options.requests[2]?.init.body))).toEqual(createRunDraftInput());
    expect(JSON.parse(String(options.requests[4]?.init.body))).toEqual(createNodeResultInput());
  });

  it('starts published workflows with version and override JSON through shared HTTP contracts', async () => {
    const response = {
      ok: true,
      status: 202,
      data: {
        dagRunId: 'run-1',
        preparationId: 'prep-1',
        dagId: 'published dag',
        version: 3,
      },
    };
    const options = createOptions([response]);

    const exitCode = await runDagCli(
      ['workflows', 'start', 'published dag', '--version', '3', '--json', '@workflow-run.json'],
      options,
    );

    expect(exitCode).toBe(0);
    expect(options.requests[0]?.url).toBe(
      `${TEST_SERVER_URL}/v1/dag/workflows/published%20dag/runs?version=3`,
    );
    expect(options.requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(options.requests[0]?.init.body))).toEqual(
      createPublishedWorkflowRequest(),
    );
    expect(JSON.parse(options.output.join(''))).toEqual(response);
  });

  it('routes asset upload, metadata, and binary content downloads through asset contracts', async () => {
    const options = createOptions([
      {
        ok: true,
        status: 201,
        data: { asset: { assetId: 'asset 1', name: 'photo.png' } },
      },
      {
        ok: true,
        status: 200,
        data: { asset: { assetId: 'asset 1', name: 'photo.png' } },
      },
      {
        ok: true,
        status: 200,
        data: { ignored: true },
      },
    ]);

    const uploadExit = await runDagCli(['assets', 'upload', '--json', '@asset.json'], options);
    const metadataExit = await runDagCli(['assets', 'get', 'asset 1'], options);
    const downloadExit = await runDagCli(
      ['assets', 'download', 'asset 1', '--output', 'photo.png'],
      options,
    );

    expect([uploadExit, metadataExit, downloadExit]).toEqual([0, 0, 0]);
    expect(options.requests.map((request) => [request.init.method, request.url])).toEqual([
      ['POST', `${TEST_SERVER_URL}/v1/dag/assets`],
      ['GET', `${TEST_SERVER_URL}/v1/dag/assets/asset%201`],
      ['GET', `${TEST_SERVER_URL}/v1/dag/assets/asset%201/content`],
    ]);
    expect(JSON.parse(String(options.requests[0]?.init.body))).toEqual(createAssetUploadRequest());
    expect(options.requests[2]?.init.body).toBeUndefined();
    expect(options.binaryWrites).toHaveLength(1);
    expect(options.binaryWrites[0]?.filePath).toBe('photo.png');
  });
});
