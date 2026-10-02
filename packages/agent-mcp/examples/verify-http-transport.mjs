import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';
import { createStreamableHttpAdapter, openMcpSession } from '../dist/node/index.js';

// Keep socket accounting in a separate Node process: Bun's HTTP server shim does not
// expose the same socket close events. The client under test still runs in Node/Bun.
const nodeExecutable = process.versions.bun ? process.argv[2] : process.execPath;
assert(nodeExecutable && isAbsolute(nodeExecutable), 'Pass an absolute Node executable when running this fixture in Bun');
const serverSource = String.raw`import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
const sockets = new Set();
const hosts = [];
let streams = 0;
const server = createServer((request, response) => {
  hosts.push(request.headers.host);
  if (request.method === 'GET') {
    streams += 1;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': fixture\n\n');
    return;
  }
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const message = JSON.parse(Buffer.concat(chunks).toString());
    if (message.method === 'initialize') {
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' },
      } }));
    } else response.writeHead(202).end();
  });
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const report = (id) => process.stdout.write(JSON.stringify({ id, port: server.address()?.port, node: process.versions.node, sockets: sockets.size, hosts, streams }) + '\n');
report(0);
const commands = createInterface({ input: process.stdin });
commands.on('line', (line) => {
  const command = JSON.parse(line);
  if (command.method === 'stats') report(command.id);
  else if (command.method === 'quit') {
    commands.close();
    process.stdin.destroy();
    server.closeAllConnections();
    server.close();
  }
});
`;
const child = spawn(nodeExecutable, ['--input-type=module', '-e', serverSource], { env: {}, stdio: ['pipe', 'pipe', 'ignore'] });
const lines = createInterface({ input: child.stdout });
const replies = new Map();
const waiting = new Map();
let finished = false;
const exited = new Promise((resolve) => {
  child.once('error', () => { finished = true; resolve(); });
  child.once('exit', () => { finished = true; resolve(); });
});
lines.on('line', (line) => {
  const reply = JSON.parse(line);
  const resolve = waiting.get(reply.id);
  if (resolve) resolve(reply);
  else replies.set(reply.id, reply);
});
function receive(id) {
  if (replies.has(id)) {
    const reply = replies.get(id);
    replies.delete(id);
    return Promise.resolve(reply);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Fixture server did not respond')); }, 2000);
    waiting.set(id, (reply) => { clearTimeout(timer); waiting.delete(id); resolve(reply); });
  });
}
let requestId = 0;
async function stats() {
  const id = ++requestId;
  const reply = receive(id);
  child.stdin.write(`${JSON.stringify({ id, method: 'stats' })}\n`);
  return reply;
}
let lookups = 0;
let session;
try {
  const ready = await receive(0);
  const endpoint = new URL(`http://pinned-mcp-fixture.invalid:${ready.port}/mcp`);
  const adapter = createStreamableHttpAdapter({
    policy: { allowedHosts: [endpoint.hostname] },
    lookup: async () => { lookups += 1; return ['127.0.0.1']; },
  });
  const admission = await adapter.admit({ url: endpoint.href });
  assert(admission.ok);
  session = await openMcpSession({ serverId: 'fixture', transport: adapter.construct(admission.admitted), timeouts: { startupMs: 2000, perCallMs: 2000 } });
  let observed = await stats();
  const streamDeadline = Date.now() + 1000;
  while (observed.streams === 0 && Date.now() < streamDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    observed = await stats();
  }
  assert.equal(observed.streams, 1);
  assert(observed.hosts.every((host) => host === endpoint.host));
  assert(lookups >= 3);
  await session.close();
  const closeDeadline = Date.now() + 500;
  observed = await stats();
  while (observed.sockets > 0 && Date.now() < closeDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    observed = await stats();
  }
  assert.equal(observed.sockets, 0);
  process.stdout.write(`${JSON.stringify({ node: process.versions.node, bun: process.versions.bun, serverNode: ready.node, streams: observed.streams, lookups, connectionsAfterClose: observed.sockets })}\n`);
} finally {
  try { await session?.close(); }
  finally {
    if (!finished) child.stdin.end(`${JSON.stringify({ method: 'quit' })}\n`);
    const timer = setTimeout(() => child.kill(), 2000);
    await exited;
    clearTimeout(timer);
    lines.close();
  }
}
