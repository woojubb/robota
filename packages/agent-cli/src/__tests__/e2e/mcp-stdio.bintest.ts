import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const ROBOTA_BIN = fileURLToPath(new URL('../../../bin/robota.cjs', import.meta.url));
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-fidelity.jsonl');
const BIDIRECTIONAL_HOST = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'mcp-bidirectional-host.ts',
);
const BIDIRECTIONAL_LOG = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'mcp-bidirectional.jsonl',
);
const TSX = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));

async function startExternalMcpProbe(): Promise<{
  url: string;
  calls: { method: string; params?: Record<string, unknown> }[];
  failCalls: () => void;
  streamOpened: Promise<void>;
  streamClosed: Promise<void>;
  isStreamClosed: () => boolean;
  close: () => Promise<void>;
}> {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  let failToolCalls = false;
  let streamIsClosed = false;
  let markStreamOpened: () => void = () => {};
  let markStreamClosed: () => void = () => {};
  const streamOpened = new Promise<void>((resolve) => (markStreamOpened = resolve));
  const streamClosed = new Promise<void>((resolve) => (markStreamClosed = resolve));
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      response.write(': ready\n\n');
      markStreamOpened();
      response.once('close', () => {
        streamIsClosed = true;
        markStreamClosed();
      });
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const message = raw
      ? (JSON.parse(raw) as {
          id?: string | number;
          method?: string;
          params?: Record<string, unknown>;
        })
      : {};
    if (message.method) calls.push({ method: message.method, params: message.params });
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    if (message.method === 'tools/call' && failToolCalls) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { isError: true, content: [{ type: 'text', text: 'EXTERNAL_MCP_FAILURE' }] },
        }),
      );
      return;
    }
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'external-probe', version: '1' },
          }
        : message.method === 'tools/list'
          ? {
              tools: [
                {
                  name: 'echo',
                  description: 'Echo the external probe request',
                  inputSchema: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                  },
                },
              ],
            }
          : { content: [{ type: 'text', text: 'EXTERNAL_MCP_OK' }] };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing probe listener');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    failCalls: () => {
      failToolCalls = true;
    },
    streamOpened,
    streamClosed,
    isStreamClosed: () => streamIsClosed,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('robota mcp serve built binary', () => {
  it('serves and consumes MCP tools through one admitted product session', async () => {
    const server = await startExternalMcpProbe();
    const cwd = mkdtempSync(join(tmpdir(), 'robota-mcp-bidirectional-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'robota-mcp-bidirectional-home-'));
    mkdirSync(join(home, '.robota'));
    writeFileSync(join(cwd, 'served-after-client-close.txt'), 'SERVED_STILL_READY');
    writeFileSync(
      join(home, '.robota', 'settings.json'),
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'mcp-dummy-key' },
        },
        mcpServers: { probe: { type: 'http', url: server.url } },
      }),
    );
    const transport = new StdioClientTransport({
      command: TSX,
      args: [
        '--conditions=source',
        BIDIRECTIONAL_HOST,
        '--allowed-tools',
        'probe__echo,Read',
        'mcp',
        'serve',
        '--session-log',
        BIDIRECTIONAL_LOG,
        '--no-session-persistence',
      ],
      cwd,
      env: { HOME: home, PATH: process.env['PATH'] ?? '' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'bidirectional-test', version: '1' });
    let diagnostics = '';
    let carrierClosed = false;
    transport.stderr?.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    try {
      await client.connect(transport).catch((error: unknown) => {
        throw new Error(`Bidirectional host refused startup: ${String(error)}\n${diagnostics}`);
      });
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain('probe__echo');
      expect(names).toContain('robota_submit');
      const turn = await client.callTool({
        name: 'robota_submit',
        arguments: { prompt: 'Use probe' },
      });
      expect(turn.isError, diagnostics).not.toBe(true);
      expect(JSON.stringify(turn)).toContain('BIDIRECTIONAL_COMPLETE');
      const turnCall = server.calls.find((call) => call.method === 'tools/call');
      expect(turnCall?.params).toEqual({ name: 'echo', arguments: { text: 'BIDIRECTIONAL_CALL' } });
      const directResult = await client.callTool({
        name: 'probe__echo',
        arguments: { text: 'DIRECT_CALL' },
      });
      expect(directResult.isError).not.toBe(true);
      expect(JSON.stringify(directResult)).toContain('EXTERNAL_MCP_OK');
      expect(server.calls.filter((call) => call.method === 'tools/call').at(-1)?.params).toEqual({
        name: 'echo',
        arguments: { text: 'DIRECT_CALL' },
      });
      await server.streamOpened;
      expect(server.isStreamClosed()).toBe(false);
      server.failCalls();
      const failedOutbound = await client.callTool({
        name: 'probe__echo',
        arguments: { text: 'FAIL_CALL' },
      });
      expect(failedOutbound.isError).toBe(true);
      expect(JSON.stringify(failedOutbound)).toContain('EXTERNAL_MCP_FAILURE');
      const servedAfterClientClose = await client.callTool({
        name: 'Read',
        arguments: { filePath: join(cwd, 'served-after-client-close.txt') },
      });
      expect(servedAfterClientClose.isError).not.toBe(true);
      expect(JSON.stringify(servedAfterClientClose)).toContain('SERVED_STILL_READY');
      await client.close();
      carrierClosed = true;
      await server.streamClosed;
      expect(server.isStreamClosed()).toBe(true);
    } finally {
      if (!carrierClosed) await client.close();
      await server.close();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 30000);

  it('serves canonical tools, executes an allowed tool, denies a blocked tool and exits on stdin close', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-mcp-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'robota-mcp-home-'));
    mkdirSync(join(home, '.robota'));
    writeFileSync(
      join(home, '.robota', 'settings.json'),
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'mcp-dummy-key' },
        },
      }),
    );
    writeFileSync(join(cwd, 'message.txt'), 'MCP_STDIO_OK');
    const serveArgs = [
      ROBOTA_BIN,
      '--allowed-tools',
      'Read',
      'mcp',
      'serve',
      '--session-log',
      FIXTURE,
      '--no-session-persistence',
    ];
    const env = { HOME: home, PATH: process.env['PATH'] ?? '' };
    // Control: without the deny, the same server lists `Shell`, so its absence below is the deny's doing.
    const control = new Client({ name: 'binary-test-control', version: '1' });
    await control.connect(
      new StdioClientTransport({ command: process.execPath, args: serveArgs, cwd, env }),
    );
    try {
      expect((await control.listTools()).tools.map((tool) => tool.name)).toContain('Shell');
    } finally {
      await control.close();
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [...serveArgs, '--denied-tools', 'Shell'],
      cwd,
      env,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'binary-test', version: '1' });
    let diagnostics = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain('Read');
      expect(names).toContain('robota_submit');
      // A tool denied outright by name is withheld from the catalog rather than listed and then refused.
      expect(names).not.toContain('Shell');
      const allowed = await client.callTool({
        name: 'Read',
        arguments: { filePath: join(cwd, 'message.txt') },
      });
      expect(allowed.isError).not.toBe(true);
      expect(JSON.stringify(allowed)).toContain('MCP_STDIO_OK');
      const denied = await client.callTool({ name: 'Shell', arguments: { command: 'true' } });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain('Unknown tool: Shell');
      expect(diagnostics).not.toMatch(/MCP_STDIO_OK/);
    } finally {
      await client.close();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 30000);

  it('keeps startup refusal off stdout and exits nonzero', async () => {
    const child = spawn(process.execPath, [ROBOTA_BIN, 'mcp', 'serve', '--serve'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const exit = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    expect(exit).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('cannot be combined');
  }, 10000);

  it('refuses an untrusted Git workspace before connecting the carrier', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-mcp-untrusted-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'robota-mcp-untrusted-home-'));
    execFileSync('git', ['init', '-q', cwd]);
    const child = spawn(process.execPath, [ROBOTA_BIN, 'mcp', 'serve'], {
      cwd,
      env: { HOME: home, PATH: process.env['PATH'] ?? '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    try {
      const exit = await new Promise<number | null>((resolve) => child.once('exit', resolve));
      expect(exit).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('Workspace trust is required');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 10000);

  it('exits cleanly on SIGTERM after the carrier is ready', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-mcp-signal-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'robota-mcp-signal-home-'));
    mkdirSync(join(home, '.robota'));
    writeFileSync(
      join(home, '.robota', 'settings.json'),
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'mcp-dummy-key' },
        },
      }),
    );
    const child = spawn(
      process.execPath,
      [ROBOTA_BIN, 'mcp', 'serve', '--session-log', FIXTURE, '--no-session-persistence'],
      {
        cwd,
        env: { HOME: home, PATH: process.env['PATH'] ?? '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    const ready = new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes('\n')) resolve();
      });
    });
    const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'signal-test', version: '1' },
          },
        }) + '\n',
      );
      await ready;
      expect(JSON.parse(stdout.split('\n')[0] ?? '')).toMatchObject({ id: 1, result: {} });
      child.kill('SIGTERM');
      expect(await exit).toBe(0);
      expect(
        stdout
          .trim()
          .split('\n')
          .every((line) => JSON.parse(line).jsonrpc === '2.0'),
      ).toBe(true);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 15000);
});
