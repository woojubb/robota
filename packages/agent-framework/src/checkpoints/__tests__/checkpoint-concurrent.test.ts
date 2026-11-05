import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Message = { type: 'ready' | 'done' | 'refused'; id?: string; message?: string };
function next(child: ChildProcess): Promise<Message> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`contender exited before message: ${code}`)));
    child.once('message', (message) => resolve(message as Message));
  });
}

async function race(kind: 'directory' | 'project') {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-contenders-')));
  roots.push(base);
  const project = join(base, 'project');
  const state = kind === 'directory' ? join(base, 'checkpoints') : join(project, '.agent', 'checkpoints');
  mkdirSync(project);
  writeFileSync(join(project, 'a.txt'), 'original A');
  writeFileSync(join(project, 'b.txt'), 'original B');
  const fixture = fileURLToPath(new URL('./fixtures/checkpoint-contender.ts', import.meta.url));
  const tsx = createRequire(import.meta.url).resolve('tsx');
  const start = (name: string) => spawn(process.execPath, ['--import', tsx, '--conditions=source', fixture, project, state, name, kind], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const first = start('a.txt');
  let second: ChildProcess | undefined;
  let retry: ChildProcess | undefined;
  try {
    const a = await next(first);
    expect(a.type).toBe('ready');
    second = start('b.txt');
    const refused = await next(second);
    expect(refused.type).toBe('refused');
    expect(refused.message).toContain('Another checkpoint writer');
    const doneA = next(first); first.send('go'); await doneA;
    retry = start('b.txt');
    const b = await next(retry);
    expect(b.type).toBe('ready');
    const doneB = next(retry); retry.send('go'); await doneB;
    expect(a.id).toBeDefined();
    expect(b.id).toBeDefined();
    if (!a.id || !b.id) throw new Error('checkpoint id missing');
    expect(a.id).not.toBe(b.id);
    expect(readFileSync(join(state, 'session_1', a.id, 'files', '000001.content'), 'utf8')).toBe('original A');
    expect(readFileSync(join(state, 'session_1', b.id, 'files', '000001.content'), 'utf8')).toBe('original B');
  } finally {
    if (first.exitCode === null) first.kill();
    if (second && second.exitCode === null) second.kill();
    if (retry && retry.exitCode === null) retry.kill();
  }
}

it('keeps two process checkpoints distinct in directory state', async () => { await race('directory'); }, 30_000);
it.runIf(process.platform === 'linux')('keeps two process checkpoints distinct in project state', async () => { await race('project'); }, 30_000);

it.runIf(process.platform !== 'win32')('recovers the session lease after its owning process dies', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-dead-writer-')));
  roots.push(base);
  const project = join(base, 'project');
  const state = join(base, 'checkpoints');
  mkdirSync(project);
  writeFileSync(join(project, 'a.txt'), 'original A');
  const fixture = fileURLToPath(new URL('./fixtures/checkpoint-contender.ts', import.meta.url));
  const tsx = createRequire(import.meta.url).resolve('tsx');
  const start = () => spawn(process.execPath, ['--import', tsx, '--conditions=source', fixture, project, state, 'a.txt', 'directory'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const first = start();
  let retry: ChildProcess | undefined;
  try {
    expect((await next(first)).type).toBe('ready');
    const exited = once(first, 'exit');
    first.kill('SIGKILL');
    await exited;
    retry = start();
    const result = await next(retry);
    expect(result.type).toBe('ready');
    expect(result.id).toBe('turn-0002');
    const done = next(retry); retry.send('go'); await done;
  } finally {
    if (first.exitCode === null && first.signalCode === null) first.kill();
    if (retry && retry.exitCode === null && retry.signalCode === null) retry.kill();
  }
}, 30_000);
