import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { respond, type WireRequest } from './helpers/provider-wire-fixture.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = join(repoRoot, 'scripts', 'dev', 'agent');

describe.runIf(process.platform === 'linux' || process.platform === 'darwin')('print interruption recovery', () => {
  it('saves the original call before its effect and resumes with one unknown-outcome receipt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'source-cli-interruption-'));
    const home = join(root, 'home');
    const workspace = join(root, 'workspace');
    const state = join(home, '.robota');
    const marker = join(workspace, 'marker');
    const groupFile = join(workspace, 'shell.pid');
    mkdirSync(state, { recursive: true });
    mkdirSync(workspace);
    const environment = Object.fromEntries(
      ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']
        .flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
    );
    const env = { ...environment, HOME: home };
    const requests: WireRequest[] = [];
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw) as WireRequest;
      requests.push(wire);
      respond('openai', response, wire.stream === true, requests.length,
        requests.length === 1 ? { id: 'call-once', name: 'Bash', args: {
          command: `echo $$ > '${groupFile}'; printf 'once\\n' >> '${marker}'; sleep 60`,
        } } : undefined, 'RESUMED_OK');
    });
    let group = 0;
    let ownerPid = 0;
    try {
      expect(spawnSync('git', ['init', '--quiet'], { cwd: workspace, env }).status).toBe(0);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing loopback port');
      writeFileSync(join(state, 'settings.json'), JSON.stringify({
        currentProvider: 'openai', providers: { openai: {
          type: 'openai', model: 'fixture-model', apiKey: 'local-fixture',
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          options: { apiSurface: 'chat-completions' },
        } },
      }));
      const trust = spawnSync(launcher, ['trust', '--yes'], { cwd: workspace, env, encoding: 'utf8', timeout: 30_000 });
      expect(trust.status, trust.stderr).toBe(0);

      const originalPrompt = 'Run the one-time marker command.';
      const owner = spawn(launcher, ['-p', originalPrompt, '--permission-mode', 'bypassPermissions', '--output-format', 'json'], {
        cwd: workspace, env, detached: true, stdio: 'ignore',
      });
      ownerPid = owner.pid!;
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 20_000, interval: 25 });
      group = Number(readFileSync(groupFile, 'utf8'));
      process.kill(-ownerPid, 'SIGKILL');
      await new Promise<void>((resolve) => owner.once('exit', () => resolve()));
      await vi.waitFor(() => {
        try { process.kill(-group, 0); throw new Error('shell group still exists'); }
        catch (error) { expect((error as NodeJS.ErrnoException).code).toBe('ESRCH'); }
      }, { timeout: 6_000, interval: 100 });

      const sessions = join(workspace, '.robota', 'sessions');
      const file = readdirSync(sessions).find((name) => name.endsWith('.json'));
      expect(file).toBeDefined();
      const envelope = JSON.parse(readFileSync(join(sessions, file!), 'utf8')) as { record: {
        id: string; messages: Array<{ role: string; content?: string; toolCalls?: Array<{ id: string }> }>;
      } };
      const record = envelope.record;
      expect(record.messages.some((message) => message.role === 'user' && message.content?.includes(originalPrompt))).toBe(true);
      expect(record.messages.some((message) => message.role === 'assistant' && message.toolCalls?.[0]?.id === 'call-once')).toBe(true);

      const resume = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(launcher, ['-p', 'Continue after interruption.', '--resume', record.id,
          '--permission-mode', 'bypassPermissions', '--output-format', 'json'], {
          cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
        child.stdout.on('data', (chunk: Buffer) => stdout += chunk.toString());
        child.stderr.on('data', (chunk: Buffer) => stderr += chunk.toString());
        child.once('error', reject);
        child.once('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
      });
      expect(resume.status, resume.stderr).toBe(0);
      expect(JSON.parse(resume.stdout.trim())).toMatchObject({ subtype: 'success', result: 'RESUMED_OK' });
      expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['once']);
      expect(requests.at(-1)?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'call-once',
          content: expect.stringContaining('unknown') }),
      ]));
    } finally {
      if (ownerPid) try { process.kill(-ownerPid, 'SIGKILL'); } catch { /* gone */ }
      if (group) try { process.kill(-group, 'SIGKILL'); } catch { /* gone */ }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
});
