import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileRecoveryJournals } from './node';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = join(packageRoot, 'src', 'file-recovery-journal-crash-child.ts');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(kill: '' | 'mid-line') {
  const root = mkdtempSync(join(tmpdir(), 'file-recovery-journal-crash-'));
  roots.push(root);
  const result = spawnSync(process.execPath, ['--import', 'tsx', child], {
    cwd: packageRoot,
    env: { ...process.env, JOURNAL_ROOT: root, JOURNAL_KILL: kill },
    encoding: 'utf8',
    timeout: 60_000,
  });
  // Windows has no signals: killing a process ends it abnormally with no signal and no error text.
  const killed =
    result.signal === 'SIGKILL' ||
    (process.platform === 'win32' &&
      result.status !== 0 &&
      result.stdout === '' &&
      result.stderr === '');
  return { root, killed, status: result.status, stderr: result.stderr };
}

const scope = { conversationId: 'room', participantId: 'alice' };
const file = (root: string): string =>
  join(
    root,
    Buffer.from(scope.conversationId).toString('hex'),
    `${Buffer.from(scope.participantId).toString('hex')}.jsonl`,
  );

describe('the file recovery journal after a real process kill', () => {
  it('lets the child finish when nothing kills it', async () => {
    const done = run('');
    expect(done.status, done.stderr).toBe(0);
    const read = await createFileRecoveryJournals(done.root).journal(scope).read();
    expect(read).toHaveLength(2);
  });

  it('refuses the torn line a killed append left, on read and on append, and keeps the file', async () => {
    const { root, killed } = run('mid-line');
    expect(killed).toBe(true);
    const bytes = readFileSync(file(root));
    expect(bytes[bytes.length - 1]).not.toBe(0x0a);
    const journal = createFileRecoveryJournals(root).journal(scope);
    await expect(journal.read()).rejects.toMatchObject({ code: 'torn-tail' });
    await expect(
      journal.append({ kind: 'effect-call', attemptId: 'a1', actionId: 'x', callId: 'effect:x' }),
    ).rejects.toMatchObject({ code: 'torn-tail' });
    expect(readFileSync(file(root)).equals(bytes)).toBe(true);
  });
});
