/**
 * Unit/integration tests for studio/http-server.ts
 * We spin up the actual server on a random port so we can test the request routing.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import * as http from 'node:http';

// ---------------------------------------------------------------------------
// Mocks — must come before importing the module under test
// ---------------------------------------------------------------------------

const MOCK_DAG = {
  dagId: 'test-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
  ],
  edges: [{ from: 'in', to: 'out', bindings: [] }],
};

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify(MOCK_DAG)),
}));

vi.mock('@robota-sdk/dag-builder', async () => {
  const actual =
    await vi.importActual<typeof import('@robota-sdk/dag-builder')>('@robota-sdk/dag-builder');
  return {
    ...actual,
  };
});

vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    LocalDagRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'run-1', status: 'success' },
        taskRuns: [
          {
            nodeId: 'out',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'done' }),
          },
        ],
      }),
      events: {
        subscribe: vi.fn().mockImplementation((cb) => {
          // Simulate events immediately
          setTimeout(() => {
            cb({
              eventType: 'task.started',
              nodeId: 'out',
              dagRunId: 'run-1',
              taskRunId: 'tr-1',
              occurredAt: new Date().toISOString(),
            });
            cb({
              eventType: 'task.completed',
              nodeId: 'out',
              dagRunId: 'run-1',
              taskRunId: 'tr-1',
              occurredAt: new Date().toISOString(),
            });
          }, 0);
          return () => undefined;
        }),
      },
    })),
    createCliNodeRegistry: actual.createCliNodeRegistry,
    loadLocalNodeDefinitions: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../commands/run.js', () => ({
  extractFinalOutput: vi.fn().mockReturnValue('final output'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  options: http.RequestOptions & { body?: string },
): Promise<{ status: number; body: string; headers: http.IncomingMessage['headers'] }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('startStudioServer', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const { startStudioServer } = await import('../studio/http-server.js');
    // Use a high ephemeral port range to avoid conflicts
    const result = await startStudioServer(49200, { cwd: '/fake/cwd' });
    server = result.server;
    // server.address() returns the actual bound port when port arg was given
    const addr = server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : result.port;
  });

  afterAll(() => {
    server?.close();
  });

  it('starts the server and returns port number', () => {
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // GET / — HTML UI
  // -------------------------------------------------------------------------

  it('GET / returns 200 with HTML', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('text/html');
    expect(result.body).toContain('DAG Studio');
  });

  // -------------------------------------------------------------------------
  // OPTIONS — CORS preflight
  // -------------------------------------------------------------------------

  it('OPTIONS returns 204 with CORS headers', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag',
      method: 'OPTIONS',
    });
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe('*');
  });

  // -------------------------------------------------------------------------
  // GET /api/dag
  // -------------------------------------------------------------------------

  it('GET /api/dag without file param returns 400', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag',
      method: 'GET',
    });
    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain('Missing ?file=');
  });

  it('GET /api/dag with file param returns DAG JSON', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag?file=test.dag.json',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { dagId: string; nodes: unknown[]; edges: unknown[] };
    expect(body.dagId).toBe('test-dag');
    expect(Array.isArray(body.nodes)).toBe(true);
  });

  it('GET /api/dag returns 400 when file cannot be read', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('File not found'));

    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag?file=missing.dag.json',
      method: 'GET',
    });
    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain('Cannot read file');
  });

  it('GET /api/dag returns 400 when file is invalid JSON', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce('not-json' as unknown as string);

    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag?file=bad.dag.json',
      method: 'GET',
    });
    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toContain('Invalid JSON');
  });

  it('GET /api/dag returns 400 when file is not an object', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce('[]' as unknown as string);

    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag?file=array.dag.json',
      method: 'GET',
    });
    expect(result.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // GET /api/nodes
  // -------------------------------------------------------------------------

  it('GET /api/nodes returns node list', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/nodes',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { nodes: unknown[] };
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // POST /api/validate
  // -------------------------------------------------------------------------

  it('POST /api/validate returns validation result', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(
      JSON.stringify(MOCK_DAG) as unknown as string,
    );

    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/validate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'test.dag.json' }),
    });
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { ok: boolean; errors: unknown[] };
    expect(typeof body.ok).toBe('boolean');
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it('POST /api/validate returns 400 when body is invalid JSON', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/validate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { errors: Array<{ code: string }> };
    expect(body.errors[0]?.code).toBe('PARSE_ERROR');
  });

  it('POST /api/validate returns 400 when file is missing from body', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/validate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(result.status).toBe(400);
    const body = JSON.parse(result.body) as { errors: Array<{ code: string }> };
    expect(body.errors[0]?.code).toBe('MISSING_FILE');
  });

  it('POST /api/validate returns ok: false when DAG file cannot be read', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('No such file'));

    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/validate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'missing.dag.json' }),
    });
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as { ok: boolean; errors: Array<{ code: string }> };
    expect(body.ok).toBe(false);
    expect(body.errors[0]?.code).toBe('DAG_READ_ERROR');
  });

  // -------------------------------------------------------------------------
  // POST /api/run (SSE stream)
  // -------------------------------------------------------------------------

  it('POST /api/run returns 200 SSE stream', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValue(JSON.stringify(MOCK_DAG) as unknown as string);

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const body = JSON.stringify({ file: 'test.dag.json', inputs: { text: 'hello' } });
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/api/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('data:');
  });

  it('POST /api/run returns error SSE when body is invalid JSON', async () => {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/api/run',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('error', reject);
      req.write('invalid-json');
      req.end();
    });
    expect(result.status).toBe(200); // SSE always returns 200 before the stream
    expect(result.body).toContain('Invalid JSON body');
  });

  it('POST /api/run returns error SSE when file is missing', async () => {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const body = JSON.stringify({ inputs: { text: 'hello' } }); // no file
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/api/run',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('Missing');
    expect(result.body).toContain('file');
  });

  it('POST /api/run returns error SSE when DAG file cannot be read', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('No such file'));

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const body = JSON.stringify({ file: 'missing.dag.json' });
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/api/run',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('Cannot read file');
  });

  // -------------------------------------------------------------------------
  // 404 — unknown routes
  // -------------------------------------------------------------------------

  it('returns 404 for unknown routes', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/unknown',
      method: 'GET',
    });
    expect(result.status).toBe(404);
    const body = JSON.parse(result.body) as { error: string };
    expect(body.error).toBe('Not found');
  });

  it('returns 404 for unknown POST routes', async () => {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/unknown',
      method: 'POST',
    });
    expect(result.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Port conflict fallback
// ---------------------------------------------------------------------------

describe('startStudioServer port fallback', () => {
  it('tries the next port when preferred port is in use', async () => {
    const { startStudioServer } = await import('../studio/http-server.js');

    // Occupy a specific port
    const occupiedPort = 49300;
    const blocker = await new Promise<Server>((resolve, reject) => {
      const s = http.createServer();
      s.listen(occupiedPort, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });

    try {
      // Starting on the occupied port should fall back to occupiedPort+1
      const result = await startStudioServer(occupiedPort, { cwd: '/tmp' });
      const addr = result.server.address();
      const actualPort = typeof addr === 'object' && addr !== null ? addr.port : result.port;
      expect(actualPort).toBeGreaterThan(occupiedPort);
      result.server.close();
    } finally {
      blocker.close();
    }
  });
});
