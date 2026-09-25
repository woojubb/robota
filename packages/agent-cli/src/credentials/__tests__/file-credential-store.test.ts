import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../file-credential-store.js';

/**
 * The headless fallback. Its whole claim is that only the owner can read what it keeps, so the
 * modes are asserted rather than assumed, including over a directory an older version made wide.
 */

const posix = process.platform !== 'win32';
const KEY = { service: 'robota.test', account: 'alpha' } as const;
const SECRET = 'SECRET-VALUE-4f1c';

let home: string;
let root: string;
let directory: string;

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

function onlyRecord(): string {
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
  expect(files).toHaveLength(1);
  return join(directory, files[0]!);
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'file-credentials-')));
  root = join(home, '.robota');
  directory = join(root, 'credentials');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe.runIf(posix)('owner-only file credential store: permissions', () => {
  it('writes each secret as a 0600 file in a 0700 directory', async () => {
    await createFileCredentialStore(directory, { withinRoot: root }).set(KEY, SECRET);
    expect(modeOf(directory)).toBe(0o700);
    expect(modeOf(root)).toBe(0o700);
    expect(modeOf(onlyRecord())).toBe(0o600);
  });

  it('tightens a directory an older version left wide before writing into it', async () => {
    mkdirSync(directory, { recursive: true, mode: 0o755 });
    chmodSync(root, 0o755);
    chmodSync(directory, 0o777);
    await createFileCredentialStore(directory, { withinRoot: root }).set(KEY, SECRET);
    expect(modeOf(root)).toBe(0o700);
    expect(modeOf(directory)).toBe(0o700);
  });

  it('tightens a record left group- or world-readable before reading it', async () => {
    const store = createFileCredentialStore(directory, { withinRoot: root });
    await store.set(KEY, SECRET);
    const record = onlyRecord();
    chmodSync(record, 0o644);
    expect(await store.get(KEY)).toBe(SECRET);
    expect(modeOf(record)).toBe(0o600);
  });
});

describe('owner-only file credential store: creation and races', () => {
  it('never reuses a stale temp file an interrupted writer left behind at a wide mode', async () => {
    const store = createFileCredentialStore(directory, { withinRoot: root });
    await store.set(KEY, 'first');
    const record = onlyRecord();
    const stale = `${record}.${process.pid}.tmp`;
    writeFileSync(stale, 'left by a crashed writer', { mode: 0o666 });
    chmodSync(stale, 0o666);

    await store.set(KEY, SECRET);

    expect(await store.get(KEY)).toBe(SECRET);
    if (posix) expect(modeOf(record)).toBe(0o600);
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('two stores racing to set the same key leave one whole record, never a torn one', async () => {
    const first = createFileCredentialStore(directory, { withinRoot: root });
    const second = createFileCredentialStore(directory, { withinRoot: root });
    await Promise.all([first.set(KEY, 'from-first'), second.set(KEY, 'from-second')]);

    expect(['from-first', 'from-second']).toContain(await first.get(KEY));
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a record written for another key rather than handing its secret out', async () => {
    const store = createFileCredentialStore(directory, { withinRoot: root });
    await store.set(KEY, SECRET);
    const record = onlyRecord();
    const parsed = JSON.parse(readFileSync(record, 'utf8')) as { key: { account: string } };
    parsed.key.account = 'someone-else';
    writeFileSync(record, JSON.stringify(parsed));

    await expect(store.get(KEY)).rejects.toThrow(/robota\.test\/alpha/);
  });
});

describe('owner-only file credential store: secrets stay out of errors', () => {
  it('a corrupt record fails naming the key, never quoting the content', async () => {
    const store = createFileCredentialStore(directory, { withinRoot: root });
    await store.set(KEY, SECRET);
    writeFileSync(onlyRecord(), `{"secret":"${SECRET}"`);

    const error = await store.get(KEY).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/robota\.test\/alpha/);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(SECRET);
    expect((error as Error).cause).toBeUndefined();
  });
});
