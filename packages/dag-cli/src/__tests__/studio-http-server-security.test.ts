/**
 * SEC: security regression tests for studio/http-server.ts.
 *
 * These tests deliberately DO NOT mock `node:fs/promises` (unlike studio-http-server.test.ts) because
 * path-containment must be proven against the real filesystem, including real symlinks.
 *
 * Threat model: `dag studio` binds 127.0.0.1 and serves its own UI from the same origin, so any web page
 * the developer visits must NOT be able to (a) reach the API cross-origin, (b) reach it via DNS rebinding,
 * or (c) point it at a file outside the studio's working directory.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import * as http from 'node:http';

import { startStudioServer } from '../studio/http-server.js';

const DAG_JSON = JSON.stringify({
  dagId: 'contained-dag',
  version: 1,
  status: 'draft',
  nodes: [{ nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} }],
  edges: [],
});

interface IHttpResult {
  status: number;
  body: string;
  headers: http.IncomingMessage['headers'];
}

function request(options: http.RequestOptions & { body?: string }): Promise<IHttpResult> {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolvePromise({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

describe('studio HTTP server — security', () => {
  let server: Server;
  let port: number;
  let root: string;
  let cwd: string;
  let outsideFile: string;

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'dag-studio-sec-')));
    cwd = join(root, 'project');
    const outside = join(root, 'outside');
    mkdirSync(cwd);
    mkdirSync(outside);
    outsideFile = join(outside, 'secret.dag.json');
    writeFileSync(outsideFile, DAG_JSON, 'utf8');
    writeFileSync(join(cwd, 'ok.dag.json'), DAG_JSON, 'utf8');
    // A symlink that lives INSIDE cwd but points OUTSIDE it — lexical `resolve()` cannot catch this.
    symlinkSync(outside, join(cwd, 'escape-link'), 'dir');

    const started = await startStudioServer(49400, { cwd });
    server = started.server;
    const addr = server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : started.port;
  });

  afterAll(() => {
    server?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Path containment
  // -------------------------------------------------------------------------

  it('GET /api/dag rejects an absolute path outside cwd', async () => {
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/dag?file=${encodeURIComponent(outsideFile)}`,
      method: 'GET',
    });
    expect(result.status).toBe(400);
    expect(result.body).toContain('outside the working directory');
    expect(result.body).not.toContain('contained-dag');
  });

  it('GET /api/dag rejects a ../ traversal out of cwd', async () => {
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag?file=../outside/secret.dag.json',
      method: 'GET',
    });
    expect(result.status).toBe(400);
    expect(result.body).toContain('outside the working directory');
  });

  it('GET /api/dag rejects a path escaping via a symlink inside cwd', async () => {
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag?file=escape-link/secret.dag.json',
      method: 'GET',
    });
    expect(result.status).toBe(400);
    expect(result.body).toContain('outside the working directory');
    expect(result.body).not.toContain('contained-dag');
  });

  it('GET /api/dag still serves a file contained in cwd', async () => {
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/dag?file=ok.dag.json',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('contained-dag');
  });

  it('POST /api/run refuses to execute a DAG outside cwd', async () => {
    const body = JSON.stringify({ file: outsideFile });
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/run',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    expect(result.body).toContain('outside the working directory');
    // The run must never have started.
    expect(result.body).not.toContain('task.started');
    expect(result.body).not.toContain('"type":"final"');
  });

  it('POST /api/validate refuses a DAG outside cwd', async () => {
    const body = JSON.stringify({ file: outsideFile });
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/validate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    expect(result.status).toBe(400);
    expect(result.body).toContain('outside the working directory');
  });

  // -------------------------------------------------------------------------
  // CORS — the UI is same-origin, so no cross-origin access may be granted
  // -------------------------------------------------------------------------

  it('does not send Access-Control-Allow-Origin on JSON responses', async () => {
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/nodes',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not send Access-Control-Allow-Origin on the /api/run SSE stream', async () => {
    const body = JSON.stringify({ file: 'ok.dag.json' });
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/run',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // DNS rebinding — Host header must be a loopback name
  // -------------------------------------------------------------------------

  it('rejects a non-loopback Host header with 403', async () => {
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/nodes',
      method: 'GET',
      headers: { Host: `evil.example.com:${port}` },
    });
    expect(result.status).toBe(403);
  });

  it('rejects a non-loopback Host header on POST /api/run with 403', async () => {
    const body = JSON.stringify({ file: 'ok.dag.json' });
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/run',
      method: 'POST',
      headers: {
        Host: `evil.example.com:${port}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });
    expect(result.status).toBe(403);
    expect(result.body).not.toContain('data:');
  });

  it('accepts a localhost Host header', async () => {
    const result = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/nodes',
      method: 'GET',
      headers: { Host: `localhost:${port}` },
    });
    expect(result.status).toBe(200);
  });
});
