import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Message = { type: 'ready' | 'done'; id: string };
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
  const second = start('b.txt');
  try {
    const [a, b] = await Promise.all([next(first), next(second)]);
    const doneA = next(first); first.send('go'); await doneA;
    const doneB = next(second); second.send('go'); await doneB;
    expect(a.id).not.toBe(b.id);
    expect(readFileSync(join(state, 'session_1', a.id, 'files', '000001.content'), 'utf8')).toBe('original A');
    expect(readFileSync(join(state, 'session_1', b.id, 'files', '000001.content'), 'utf8')).toBe('original B');
  } finally {
    if (first.exitCode === null) first.kill();
    if (second.exitCode === null) second.kill();
  }
}

it('keeps two process checkpoints distinct in directory state', async () => { await race('directory'); }, 30_000);
it.runIf(process.platform === 'linux')('keeps two process checkpoints distinct in project state', async () => { await race('project'); }, 30_000);
