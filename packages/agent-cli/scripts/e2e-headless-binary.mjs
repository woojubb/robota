#!/usr/bin/env node
/** RUNTIME-002: real compiled-artifact parity, presentation graph, and self-worker proof. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinGeneration } from '../../../scripts/artifacts/generation.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? '.exe' : '';
const fullName = `robota-${target}${exe}`;
const headlessName = `robota-headless-${target}${exe}`;
const source = pinGeneration(packageRoot);
for (const args of [[target], ['headless', target]]) {
  const compile = spawnSync('bun', [join(packageRoot, 'scripts', 'build-bun.mjs'), ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  if (compile.status !== 0) throw new Error(`Bun compile failed: ${compile.stderr}`);
}
if (pinGeneration(packageRoot).id !== source.id)
  throw new Error('Node input generation changed during paired Bun builds');
const full = pinGeneration(packageRoot, { outputName: 'dist-bun' });
const headless = pinGeneration(packageRoot, { outputName: 'dist-bun-headless' });
const fullBin = join(full.root, fullName);
const headlessBin = join(headless.root, headlessName);
const fail = (message) => {
  throw new Error(`RUNTIME-002: ${message}`);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

for (const [generation, name] of [
  [full, fullName],
  [headless, headlessName],
]) {
  assert(
    generation.manifest.files.some((record) => record.path === name),
    `missing verified ${name}`,
  );
}

// Traverse the emitted local import graph rather than trusting one minified file's string content.
const queue = ['headless.js'];
const visited = new Set();
const localImport = /\b(?:from\s*|import\s*\(?\s*)["'](\.[^"']+)["']/g;
while (queue.length) {
  const name = queue.pop();
  if (visited.has(name)) continue;
  visited.add(name);
  const code = readFileSync(join(source.root, 'node', name), 'utf8');
  assert(
    !/react-devtools-core|@robota-sdk\/agent-ui-terminal|["']ink["']/.test(code),
    `${name} reaches terminal presentation`,
  );
  for (const match of code.matchAll(localImport)) {
    queue.push(join(dirname(name), match[1]));
  }
}
assert(visited.size > 1, 'headless build graph traversal did not reach its shared code');

const fullSize = statSync(fullBin).size;
const headlessSize = statSync(headlessBin).size;
assert(
  headlessSize < fullSize,
  `headless binary ${headlessSize} bytes is not smaller than full ${fullSize}`,
);
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
console.log(`full ${target}: ${fullSize} bytes sha256 ${digest(fullBin)}`);
console.log(`headless ${target}: ${headlessSize} bytes sha256 ${digest(headlessBin)}`);
console.log(
  `reduction: ${fullSize - headlessSize} bytes (${(((fullSize - headlessSize) / fullSize) * 100).toFixed(2)}%)`,
);

const denied = spawnSync(headlessBin, [], { encoding: 'utf8' });
assert(
  denied.status !== 0 && /only --serve/.test(denied.stderr),
  'headless default launch did not refuse',
);

async function workerReady(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['--__robota-subagent-worker'], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`worker timeout: ${stderr}`));
    }, 10000);
    child.once('message', (message) => {
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve(message);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
const workerFull = await workerReady(fullBin);
const workerHeadless = await workerReady(headlessBin);
assert(
  workerFull.type === 'ready' && workerHeadless.type === 'ready',
  'self-reexecuted worker did not send ready',
);
assert(
  JSON.stringify(workerFull.composedToolNames) === JSON.stringify(workerHeadless.composedToolNames),
  'worker composition diverged',
);

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
async function waitTcp(port) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const open = await new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      const finish = (value) => {
        socket.destroy();
        resolve(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (open) return;
    if (Date.now() > deadline) fail(`serve did not listen on ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
function framesAt(url, ms) {
  return new Promise((resolve) => {
    const frames = [];
    const ws = new WebSocket(url);
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve({ frames, closed });
    };
    const timer = setTimeout(() => finish(false), ms);
    ws.onmessage = (event) => {
      try {
        frames.push(JSON.parse(String(event.data)));
      } catch {
        /* non-JSON frame */
      }
      if (frames.some((frame) => frame.type === 'messages')) finish(false);
    };
    ws.onclose = () => finish(true);
  });
}
async function serve(binary) {
  const cwd = mkdtempSync(join(tmpdir(), 'runtime002-cwd-'));
  const home = mkdtempSync(join(tmpdir(), 'runtime002-home-'));
  mkdirSync(join(cwd, '.robota'));
  mkdirSync(join(home, '.robota'));
  const settings = JSON.stringify({
    currentProvider: 'anthropic',
    providers: {
      anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'dummy-no-request' },
    },
    mcpServers: { probe: { type: 'http', url: 'http://127.0.0.1:9/mcp' } },
  });
  writeFileSync(join(home, '.robota', 'settings.json'), settings);
  const token = 'runtime002-test-token';
  const port = await freePort();
  const child = spawn(binary, ['--serve', '--no-session-persistence'], {
    cwd,
    env: { ...process.env, HOME: home, ROBOTA_WS_TOKEN: token, ROBOTA_WS_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  try {
    try {
      await waitTcp(port);
    } catch (error) {
      throw new Error(`${error.message}; ${stderr}`);
    }
    assert(
      stderr.includes('MCP server "probe" was not admitted (pending)'),
      `MCP startup did not enforce approval: ${stderr}`,
    );
    const good = await framesAt(`ws://127.0.0.1:${port}?token=${token}`, 8000);
    const bad = await framesAt(`ws://127.0.0.1:${port}?token=wrong`, 3000);
    assert(
      good.frames.some((frame) => frame.type === 'messages'),
      `authenticated session failed: ${stderr}`,
    );
    assert(
      bad.closed && !bad.frames.some((frame) => frame.type === 'messages'),
      'wrong nonce leaked session data',
    );
    const exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    child.kill('SIGTERM');
    const terminal = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 8000)),
    ]);
    assert(
      !terminal.timeout && terminal.code === 0,
      `serve did not shut down cleanly: ${JSON.stringify(terminal)} ${stderr}`,
    );
    return { firstType: good.frames[0]?.type, terminal };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}
const fullServe = await serve(fullBin);
const headlessServe = await serve(headlessBin);
assert(fullServe.firstType === headlessServe.firstType, 'initial wire frame diverged');
const appDir = join(packageRoot, '..', '..', 'apps', 'agent-app');
const bundled = spawnSync(process.execPath, [join(appDir, 'scripts', 'bundle-runtime.mjs')], {
  encoding: 'utf8',
});
assert(bundled.status === 0, `desktop bundle source failed: ${bundled.stderr}`);
const resource = join(
  appDir,
  'resources-bin',
  process.platform === 'win32' ? 'robota.exe' : 'robota',
);
assert(
  digest(resource) === digest(headlessBin),
  'desktop resource is not the verified headless binary',
);
assert(digest(resource) !== digest(fullBin), 'desktop accidentally bundled the full CLI binary');
console.log(`desktop resource: ${digest(resource)} (verified headless artifact)`);
console.log(
  `serve parity: ${fullServe.firstType}, nonce rejection, SIGTERM exit 0; worker ready parity; graph ${visited.size} modules`,
);
