/**
 * GUI-006 headless web smoke (TC-03, agent-owned — never deferred to the owner).
 *
 * Serves the built `dist/` over a tiny static server and loads BOTH pages in headless Chromium (Playwright):
 *   - index.html  → the localhost-WS monitor (`SessionMonitor` from the GUI core) renders its shell.
 *   - remote.html → the Stage-D browser remote client (`RemoteClient` from agent-transport-webrtc-web) mounts.
 * Writes PNG screenshots. Run: `pnpm --filter @robota-sdk/agent-web-monitor test:e2e`.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
const outDir = process.env.SMOKE_OUT ?? join(here, 'shots');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0].split('#')[0];
    const rel = url === '/' ? '/index.html' : url;
    const buf = await readFile(join(distDir, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });

  // TC-03a: the monitor page renders the SessionMonitor shell (from the GUI core).
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.getByText('CLI Monitor').waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(outDir, 'monitor.png') });
  check('TC-03: monitor page renders SessionMonitor (GUI core) shell', true);

  // TC-03b: the Stage-D remote page mounts RemoteClient (from agent-transport-webrtc-web). With no pairing
  // params it fails closed to the "Cannot pair" UX — proving the component mounted and parsed the URL.
  await page.goto(`${base}/remote.html`, { waitUntil: 'networkidle' });
  await page.getByText('Cannot pair').waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(outDir, 'remote.png') });
  check('TC-03: remote page mounts RemoteClient (webrtc-web)', true);
} catch (err) {
  check(`smoke threw: ${err?.message ?? err}`, false);
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? '\nWEB SMOKE PASSED' : `\nWEB SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
