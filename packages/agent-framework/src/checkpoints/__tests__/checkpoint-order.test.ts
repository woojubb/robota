import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import { createDirectoryEditCheckpointState } from '../edit-checkpoint-state-storage.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
type Message = { type: 'ready' | 'captured' | 'done' | 'refused'; id?: string; message?: string };
function next(child: ChildProcess): Promise<Message> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`contender exited before message: ${code}`)));
    child.once('message', (message) => resolve(message as Message));
  });
}
async function send(child: ChildProcess, message: string): Promise<Message> {
  const reply = next(child); child.send(message); return reply;
}

it.runIf(process.platform === 'linux').each(['directory', 'project'] as const)(
  'rolls back the original bytes after reverse-order capture in %s state',
  async (kind) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-order-')));
    roots.push(base);
    const project = join(base, 'project');
    const state = kind === 'directory' ? join(base, 'checkpoints') : join(project, '.agent', 'checkpoints');
    mkdirSync(project);
    const file = join(project, 'same.txt');
    writeFileSync(file, 'A');
    const fixture = fileURLToPath(new URL('./fixtures/checkpoint-order-contender.ts', import.meta.url));
    const tsx = createRequire(import.meta.url).resolve('tsx');
    const start = (replacement: string) => spawn(process.execPath, ['--import', tsx, '--conditions=source', fixture, project, state, replacement, kind], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const first = start('B');
    let second: ChildProcess | undefined;
    let retry: ChildProcess | undefined;
    try {
      const a = await next(first);
      second = start('C');
      const refused = await next(second);
      expect(refused.type).toBe('refused');
      expect(refused.message).toContain('Another checkpoint writer');
      await send(first, 'capture'); await send(first, 'finish');
      retry = start('C');
      const b = await next(retry);
      expect(b.type).toBe('ready');
      expect(a.id).toBeDefined();
      expect(b.id).toBeDefined();
      if (!a.id || !b.id) throw new Error('checkpoint id missing');
      expect(a.id).not.toBe(b.id);
      await send(retry, 'capture'); await send(retry, 'finish');
      expect(readFileSync(file, 'utf8')).toBe('C');
      const access = await createTrustedProjectAccessFixture(project);
      if (access.status !== 'trusted') throw new Error('fixture trust missing');
      const store = new EditCheckpointStore({
        authority: access.authority,
        mutation: createWorkspaceProjectMutation(access.authority, { status: 'approved', purpose: 'checkpoint rollback test' }),
        ...(kind === 'directory' ? { stateStorage: createDirectoryEditCheckpointState(state) } : {}),
        sealing: 'plain',
      });
      await store.rollbackThroughCheckpoint('session_1', a.id);
      expect(readFileSync(file, 'utf8')).toBe('A');
    } finally {
      if (first.exitCode === null) first.kill();
      if (second && second.exitCode === null) second.kill();
      if (retry && retry.exitCode === null) retry.kill();
    }
  }, 30_000,
);
