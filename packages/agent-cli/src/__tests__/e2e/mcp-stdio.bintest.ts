import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const ROBOTA_BIN = fileURLToPath(new URL('../../../bin/robota.cjs', import.meta.url));
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-fidelity.jsonl');

describe('robota mcp serve built binary', () => {
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
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        ROBOTA_BIN,
        '--allowed-tools',
        'Read',
        'mcp',
        'serve',
        '--session-log',
        FIXTURE,
        '--no-session-persistence',
        '--denied-tools',
        'Bash',
      ],
      cwd,
      env: { HOME: home, PATH: process.env['PATH'] ?? '' },
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
      expect(names).toContain('Bash');
      expect(names).toContain('robota_submit');
      const allowed = await client.callTool({
        name: 'Read',
        arguments: { filePath: join(cwd, 'message.txt') },
      });
      expect(allowed.isError).not.toBe(true);
      expect(JSON.stringify(allowed)).toContain('MCP_STDIO_OK');
      const denied = await client.callTool({ name: 'Bash', arguments: { command: 'true' } });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toMatch(/denied|permission/i);
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
