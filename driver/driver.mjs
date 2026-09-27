#!/usr/bin/env node
// Audit driver: keeps one Playwright page (Chrome or the Electron app) alive and runs snippets against it.
//   node driver.mjs browser <url> <port> [width height]
//   node driver.mjs electron <mainJs> <port> <cwd>   (env passes through, incl. HOME and ROBOTA_GUI_SIDECAR_CMD)
// POST /eval  body = JS function body with `page`, `ctx` in scope (async), returns JSON of the return value.
// GET  /shot?name=x[&full=1]  saves <EVIDENCE>/<name>.png
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const AUDIT = '/private/tmp/claude-501/-Users-jungyoun-Documents-dev-woojubb-robota-5/6fbad5fc-64cb-4621-8e62-92858510d96a/scratchpad/robota-audit';
const require = createRequire(join(AUDIT, 'packages/agent-gui-web/package.json'));
const { chromium, _electron } = require('playwright');
const EVIDENCE = process.env.EVIDENCE ?? '/private/tmp/claude-501/-Users-jungyoun-Documents-dev-woojubb-robota-5/6fbad5fc-64cb-4621-8e62-92858510d96a/scratchpad/evidence';
mkdirSync(EVIDENCE, { recursive: true });

const [mode, target, portArg, a4, a5] = process.argv.slice(2);
const ctx = { console: [], frames: [], sent: [], errors: [] };
let page;
let app;
let browser;

function watch(p) {
  p.on('console', (m) => ctx.console.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
  p.on('pageerror', (e) => ctx.errors.push(String(e).slice(0, 500)));
  p.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => ctx.frames.push({ t: Date.now(), d: String(payload).slice(0, 2000) }));
    ws.on('framesent', ({ payload }) => ctx.sent.push({ t: Date.now(), d: String(payload).slice(0, 2000) }));
    ws.on('close', () => ctx.frames.push({ t: Date.now(), d: '<<ws closed>>' }));
  });
}

if (mode === 'browser') {
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1' });
  const width = Number(a4 ?? 1280);
  const height = Number(a5 ?? 800);
  const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
  ctx.context = context;
  page = await context.newPage();
  watch(page);
  await page.goto(target);
} else if (mode === 'electron') {
  const electronPath = createRequire(join(AUDIT, 'apps/agent-app/package.json'))('electron');
  app = await _electron.launch({ executablePath: electronPath, args: [target], cwd: a4, env: { ...process.env } });
  ctx.app = app;
  app.on('window', (w) => { watch(w); });
  page = await app.firstWindow();
  watch(page);
  app.process().stdout?.on('data', (d) => ctx.console.push(`[main-out] ${String(d).slice(0, 500)}`));
  app.process().stderr?.on('data', (d) => ctx.console.push(`[main-err] ${String(d).slice(0, 500)}`));
}
ctx.getPage = () => page;
ctx.setPage = (p) => { page = p; watch(p); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/shot') {
      const name = url.searchParams.get('name') ?? `shot-${Date.now()}`;
      const path = join(EVIDENCE, `${name}.png`);
      await page.screenshot({ path, fullPage: url.searchParams.get('full') === '1' });
      res.end(JSON.stringify({ path }));
      return;
    }
    if (url.pathname === '/eval') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const fn = new Function('page', 'ctx', `return (async () => { ${body} })();`);
      const out = await fn(page, ctx);
      res.end(JSON.stringify({ ok: true, out }, null, 1));
      return;
    }
    if (url.pathname === '/quit') {
      res.end('bye');
      if (app) await app.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      process.exit(0);
    }
    res.statusCode = 404;
    res.end('?');
  } catch (e) {
    res.end(JSON.stringify({ ok: false, error: String(e?.stack ?? e).slice(0, 3000) }));
  }
});
server.listen(Number(portArg), '127.0.0.1', () => process.stdout.write(`driver ready on ${portArg}\n`));
