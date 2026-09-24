import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
      expect(existsSync(tokenFile)).toBe(true);
      expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
      const token = readFileSync(tokenFile, 'utf8').trim();
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
