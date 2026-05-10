import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startHttpServer } from '../http-server.js';

const WS_URL = 'ws://127.0.0.1:19200';

function makeWebDist(): string {
  const dir = join(tmpdir(), `http-server-test-${process.pid}`);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
  );
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")');
  writeFileSync(join(dir, 'assets', 'app.css'), 'body{}');
  return dir;
}

describe('startHttpServer', () => {
  it('injects <meta name="ws-url"> into index.html', async () => {
    const dist = makeWebDist();
    const http = await startHttpServer({ wsUrl: WS_URL, port: 19300, webDistPath: dist });
    try {
      const res = await fetch(`http://127.0.0.1:${http.port}/`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain(`<meta name="ws-url" content="${WS_URL}"`);
    } finally {
      await http.stop();
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('serves JS assets with correct MIME type', async () => {
    const dist = makeWebDist();
    const http = await startHttpServer({ wsUrl: WS_URL, port: 19301, webDistPath: dist });
    try {
      const res = await fetch(`http://127.0.0.1:${http.port}/assets/app.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/javascript');
    } finally {
      await http.stop();
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('falls back to index.html for unknown SPA routes (with ws-url injected)', async () => {
    const dist = makeWebDist();
    const http = await startHttpServer({ wsUrl: WS_URL, port: 19302, webDistPath: dist });
    try {
      const res = await fetch(`http://127.0.0.1:${http.port}/some/spa/route`);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain(`<meta name="ws-url" content="${WS_URL}"`);
    } finally {
      await http.stop();
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('retries on EADDRINUSE and binds to next free port', async () => {
    const dist = makeWebDist();
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(19310, '127.0.0.1', resolve));
    try {
      const http = await startHttpServer({ wsUrl: WS_URL, port: 19310, webDistPath: dist });
      expect(http.port).toBe(19311);
      await http.stop();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
