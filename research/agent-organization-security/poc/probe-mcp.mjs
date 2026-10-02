/** Actual guest CLI MCP stdio lifecycle. Emits only observation flags, never session payload. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
const child = spawn(
  '/home/researcher/node/bin/node',
  ['/home/researcher/cli/dist/node/bin.js', 'mcp', 'serve', '--safe-mode'],
  {
    cwd: '/home/researcher/workspace',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: '/home/researcher/node/bin:/usr/bin:/bin',
      HOME: '/home/researcher/poc-home',
      PRODUCT_CONFIG_FILE: '/home/researcher/fixture/product.env',
      RESEARCH_FAKE_MODEL_KEY: 'synthetic-non-secret',
    },
  },
);
child.stderr.resume();
let nextId = 0;
const pending = new Map();
const lines = createInterface({ input: child.stdout });
let protocolOnly = true;
lines.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  } catch {
    protocolOnly = false;
  }
});
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('MCP response timeout'));
    }, 10000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(response);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const exit = new Promise((resolve) =>
  child.once('exit', (code, signal) => resolve({ code, signal })),
);
const records = [];
try {
  const initialized = await call('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'synthetic-research', version: '1' },
  });
  records.push({
    id: 'mcp-initialize',
    passed: Boolean(initialized.result?.protocolVersion) && !initialized.error,
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const catalog = await call('tools/list', {});
  const submit = catalog.result?.tools?.find((tool) => tool.name.endsWith('_submit'));
  records.push({ id: 'mcp-catalog', passed: Boolean(submit?.inputSchema) });
  assert(submit);
  const result = await call('tools/call', {
    name: submit.name,
    arguments: { prompt: 'RESEARCH_HEADLESS' },
  });
  records.push({
    id: 'mcp-actual-cli-submit',
    passed: !result.error && JSON.stringify(result.result).includes('RESEARCH_HEADLESS_VM_OK'),
  });
} finally {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
  const stopped = await exit;
  clearTimeout(timer);
  lines.close();
  records.push({ id: 'mcp-clean-stop', passed: stopped.signal !== 'SIGKILL', observed: stopped });
}
records.push({ id: 'mcp-stdout-is-protocol', passed: protocolOnly });
process.stdout.write(
  JSON.stringify(
    {
      kind: 'actual-cli-mcp-stdio-guest',
      records,
      limitations: [
        'Remote HTTP issuer/JWK policy and desktop remote UI are not exercised by stdio.',
      ],
    },
    null,
    2,
  ) + '\n',
);
assert(records.every((record) => record.passed));
