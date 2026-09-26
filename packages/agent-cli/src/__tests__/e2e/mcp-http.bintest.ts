import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';

const ROBOTA_BIN = fileURLToPath(new URL('../../../bin/robota.cjs', import.meta.url));
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-fidelity.jsonl');

describe('robota mcp serve loopback HTTP binary', () => {
  it('issues a private token, serves a real client, and cleans up on SIGTERM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-mcp-http-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'robota-mcp-http-home-'));
    const tokenFile = join(home, 'mcp-token');
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
    writeFileSync(join(cwd, 'message.txt'), 'MCP_HTTP_OK');
    const child = spawn(
      process.execPath,
      [
        ROBOTA_BIN,
        'mcp',
        'serve',
        '--http-token-file',
        tokenFile,
        '--allowed-tools',
        'Read',
        '--session-log',
        FIXTURE,
        '--no-session-persistence',
      ],
      {
        cwd,
        env: { HOME: home, PATH: process.env['PATH'] ?? '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let diagnostics = '';
    let stdout = '';
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const client = new Client({ name: 'http-binary-test', version: '1' });
    try {
      await vi.waitFor(
        () => expect(diagnostics).toMatch(/MCP HTTP listening at http:\/\/127\.0\.0\.1:\d+\/mcp/),
        { timeout: 15000 },
      );
      // Opened once (which fails if the file is missing): the mode checked is the file read.
      const tokenFd = openSync(tokenFile, 'r');
      let token: string;
      try {
        expect(fstatSync(tokenFd).mode & 0o777).toBe(0o600);
        token = readFileSync(tokenFd, 'utf8').trim();
      } finally {
        closeSync(tokenFd);
      }
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(diagnostics).not.toContain(token);
      expect(stdout).toBe('');
      const url = diagnostics.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)?.[0];
      if (!url) throw new Error('MCP HTTP endpoint missing');
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name)).toContain('robota_submit');
      expect(tools.map((tool) => tool.name)).not.toContain('agent_submit');
      expect(tools.find((tool) => tool.name === 'robota_submit')?.description).toBe(
        'Robota extension: submit a prompt to the agent and await its own turn',
      );
      const result = await client.callTool({
        name: 'Read',
        arguments: { filePath: join(cwd, 'message.txt') },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).toContain('MCP_HTTP_OK');
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    } finally {
      try {
        await client.close();
      } finally {
        if (child.exitCode === null) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGTERM');
          await exited;
        }
        expect(existsSync(tokenFile)).toBe(false);
        rmSync(cwd, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    }
  }, 30000);
});

function prepareHome(prefix: string): { cwd: string; home: string } {
  const cwd = mkdtempSync(join(tmpdir(), `${prefix}-cwd-`));
  const home = mkdtempSync(join(tmpdir(), `${prefix}-home-`));
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
  return { cwd, home };
}

function get(
  port: number,
  path: string,
  method: string,
): Promise<{ status: number; challenge: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { Host: 'agents.example.test', 'Content-Type': 'application/json' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            challenge: res.headers['www-authenticate'],
            body,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

describe('robota mcp serve remote authorization binary', () => {
  it('refuses a non-loopback bind with the loopback token file', () => {
    const { cwd, home } = prepareHome('robota-mcp-refuse');
    const tokenFile = join(home, 'mcp-token');
    try {
      const result = spawnSync(
        process.execPath,
        [ROBOTA_BIN, 'mcp', 'serve', '--http-host', '0.0.0.0', '--http-token-file', tokenFile],
        { cwd, env: { HOME: home, PATH: process.env['PATH'] ?? '' }, encoding: 'utf8' },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('non-loopback address only with --http-public-url');
      expect(existsSync(tokenFile)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('serves protected-resource metadata and challenges a request without a token', async () => {
    const { cwd, home } = prepareHome('robota-mcp-remote');
    const child = spawn(
      process.execPath,
      [
        ROBOTA_BIN,
        'mcp',
        'serve',
        '--http-public-url',
        'https://agents.example.test/robota/mcp',
        '--oauth-issuer',
        'https://auth.example.test',
        '--oauth-scopes',
        'mcp:use',
        '--oauth-allowed-subjects',
        'alice',
        '--allowed-tools',
        'Read',
        '--session-log',
        FIXTURE,
        '--no-session-persistence',
      ],
      {
        cwd,
        env: { HOME: home, PATH: process.env['PATH'] ?? '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let diagnostics = '';
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    try {
      await vi.waitFor(
        () => expect(diagnostics).toMatch(/MCP HTTP listening on 127\.0\.0\.1:\d+ for https:/),
        { timeout: 15000 },
      );
      const port = Number(diagnostics.match(/127\.0\.0\.1:(\d+)/)?.[1]);
      const metadata = await get(port, '/.well-known/oauth-protected-resource/robota/mcp', 'GET');
      expect(metadata.status).toBe(200);
      expect(JSON.parse(metadata.body)).toMatchObject({
        resource: 'https://agents.example.test/robota/mcp',
        authorization_servers: ['https://auth.example.test'],
        scopes_supported: ['mcp:use'],
      });
      const refused = await get(port, '/robota/mcp', 'POST');
      expect(refused.status).toBe(401);
      expect(refused.body).toBe('');
      expect(refused.challenge).toBe(
        'Bearer resource_metadata="https://agents.example.test/.well-known/oauth-protected-resource/robota/mcp"',
      );
      await vi.waitFor(() =>
        expect(diagnostics).toContain('MCP HTTP refused: missing-token (loopback)'),
      );
    } finally {
      if (child.exitCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        await exited;
      }
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 30000);
});
