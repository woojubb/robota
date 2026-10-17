import { createBuiltInBinaryEnvironment } from './helpers/product-runtime.js';
/**
 * `robota acp` run from source as an editor would launch it: a child process speaking ACP on
 * its stdio, driven by the SDK's own client. The replay provider answers from a recorded log, so no
 * model or key is involved.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { client, ndJsonStream } from '@agentclientprotocol/sdk';
import { afterAll, describe, expect, it } from 'vitest';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const replayLog = fileURLToPath(new URL('./e2e/fixtures/sec-016-tool-call.jsonl', import.meta.url));
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'robota-acp-run-')));
const home = path.join(scratch, 'home');
const repo = path.join(scratch, 'repo');
mkdirSync(path.join(home, '.robota'), { recursive: true });
writeFileSync(
  path.join(home, '.robota', 'settings.json'),
  JSON.stringify({
    currentProvider: 'anthropic',
    // Boots the CLI; --session-log swaps in the replay provider so the key is never used.
    providers: {
      anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'acp-dummy-key' },
    },
  }),
);
execFileSync('git', ['init', '--quiet', repo]);
writeFileSync(path.join(repo, 'SEC-016-PROBE.txt'), 'probe contents\n');

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Launch the agent and connect an SDK editor client to its stdio. */
function launch(extra: readonly string[]) {
  const child = spawn(
    launcher,
    ['acp', '--session-log', replayLog, '--no-session-persistence', ...extra],
    { cwd: repo, env: createBuiltInBinaryEnvironment(home), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
  const updates: SessionUpdate[] = [];
  const permissions: string[] = [];
  const editor = client({ name: 'acp-source-run' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params.update);
    })
    .onRequest('session/request_permission', ({ params }) => {
      permissions.push(params.toolCall.title ?? '');
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } };
    })
    .connect(
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
  return {
    child,
    agent: editor.agent,
    updates,
    permissions,
    stderr: () => stderr,
    /** The editor closes its end; a well-behaved agent exits. */
    async close(): Promise<number | null> {
      child.stdin.end();
      return Promise.race([
        exited,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error(`agent did not exit\n${stderr}`)), 30_000),
        ),
      ]);
    },
  };
}

describe('acp from source', () => {
  it('refuses an untrusted workspace inside session/new, naming the trust command, and stays up', async () => {
    const run = launch([]);
    try {
      await expect(run.agent.request('initialize', { protocolVersion: 1 })).resolves.toMatchObject({
        protocolVersion: 1,
      });
      const refusal = await run.agent
        .request('session/new', { cwd: repo, mcpServers: [] })
        .catch((error: unknown) => error);
      expect(refusal).toMatchObject({ code: -32000 });
      expect((refusal as Error).message).toContain('robota trust --yes');
      expect(run.child.exitCode).toBeNull();
    } finally {
      await run.close();
    }
  }, 90_000);

  it('runs a prompt and a slash command in a workspace the person chose to run Restricted', async () => {
    const run = launch(['--restricted-workspace']);
    try {
      await run.agent.request('initialize', { protocolVersion: 1 });
      const { sessionId } = await run.agent.request('session/new', { cwd: repo, mcpServers: [] });

      const turn = await run.agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'read the probe file' }],
      });
      expect(turn).toEqual({ stopReason: 'end_turn' });
      expect(run.updates).toContainEqual(
        expect.objectContaining({ sessionUpdate: 'tool_call', kind: 'read' }),
      );
      expect(run.updates).toContainEqual(
        expect.objectContaining({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: expect.stringContaining('SEC_016_TURN_COMPLETE') },
        }),
      );

      run.updates.length = 0;
      const help = await run.agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/help' }],
      });
      expect(help).toEqual({ stopReason: 'end_turn' });
      const reply = run.updates
        .map((u) =>
          u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text'
            ? u.content.text
            : '',
        )
        .join('');
      expect(reply).toContain('/help');
    } finally {
      await expect(run.close()).resolves.toBe(0);
    }
  }, 120_000);
});
