import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SecretStore } from '../accounts/secret-store.js';
import { AccountStore } from '../accounts/store.js';
import type { IAccountRecord } from '../accounts/types.js';
import { hostnameFor, validateAccountId, validateProvider } from '../accounts/validate.js';
import { AuditLog } from '../audit.js';
import { HostError } from '../errors.js';
import { writeFileAtomic } from '../fs-util.js';
import { BASE_DOMAIN, cleanTempDirs, KEY, tempDir } from './harness.js';

afterEach(cleanTempDirs);

const unix = process.platform !== 'win32';
const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

function record(id: string, slot = 0): IAccountRecord {
  return {
    id,
    hostname: hostnameFor(id, BASE_DOMAIN),
    backend: 'container',
    state: 'active',
    provider: { type: 'anthropic' },
    keySource: 'account',
    limits: { memoryMb: 512, cpus: 1, pids: 64 },
    subnetSlot: slot,
    image: 'personal-agent:test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof HostError ? error.code : 'untyped';
  }
  return undefined;
}

describe('account id and provider validation', () => {
  it.each(['a', 'alice', 'a1', 'a-b', 'a'.repeat(31)])('accepts %s', (id) => {
    expect(validateAccountId(id)).toBe(id);
  });

  it.each(['', '1abc', 'Alice', 'a_b', 'a-', '-a', 'a.b', 'a'.repeat(32), 'a b', '../x', 7])(
    'refuses %s',
    (id) => {
      expect(code(() => validateAccountId(id))).toBe('invalid-input');
    },
  );

  it('fixes the hostname as id plus base domain', () => {
    expect(hostnameFor('alice', BASE_DOMAIN)).toBe('alice.agents.example.test');
  });

  it('refuses a provider base URL that carries credentials', () => {
    expect(
      code(() => validateProvider({ type: 'openai', baseUrl: 'https://user:pw@api.example.test' })),
    ).toBe('invalid-input');
    expect(
      code(() => validateProvider({ type: 'openai', baseUrl: 'ftp://api.example.test' })),
    ).toBe('invalid-input');
    expect(
      validateProvider({ type: 'openai', baseUrl: 'https://api.example.test/v1' }).baseUrl,
    ).toBe('https://api.example.test/v1');
  });
});

describe('account store', () => {
  it('creates the state directory 0700 and the store 0600 with a generated install id', async () => {
    const dir = join(await tempDir(), 'state');
    const store = await AccountStore.open(dir);
    expect(store.installId).toMatch(/^[a-f0-9]{8}$/u);
    if (unix) {
      expect(await mode(dir)).toBe(0o700);
      expect(await mode(join(dir, 'accounts.json'))).toBe(0o600);
    }
  });

  it('tightens a state directory that was too open', async () => {
    const dir = await tempDir();
    await chmod(dir, 0o755);
    await AccountStore.open(dir);
    if (unix) expect(await mode(dir)).toBe(0o700);
  });

  it('keeps the install id and records across a reload', async () => {
    const dir = await tempDir();
    const first = await AccountStore.open(dir);
    await first.put(record('alice', 0));
    await first.put(record('bob', 1));
    const second = await AccountStore.open(dir);
    expect(second.installId).toBe(first.installId);
    expect(second.list().map((a) => a.id)).toEqual(['alice', 'bob']);
    expect(second.get('alice')).toEqual(record('alice', 0));
    await second.remove('alice');
    expect((await AccountStore.open(dir)).list().map((a) => a.id)).toEqual(['bob']);
  });

  it('returns copies so callers cannot edit the store by accident', async () => {
    const store = await AccountStore.open(await tempDir());
    await store.put(record('alice'));
    const copy = store.get('alice');
    if (copy) copy.state = 'deleting';
    expect(store.get('alice')?.state).toBe('active');
  });

  it('leaves no temporary file and keeps mode 0600 after writes', async () => {
    const dir = await tempDir();
    const store = await AccountStore.open(dir);
    for (let i = 0; i < 5; i += 1) await store.put(record(`acct${i}`, i));
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    if (unix) expect(await mode(join(dir, 'accounts.json'))).toBe(0o600);
  });

  it('refuses a malformed store instead of starting empty', async () => {
    const cases: Array<[string, string]> = [
      ['not json', '{nope'],
      ['array', '[]'],
      ['wrong version', JSON.stringify({ version: 2, installId: 'abcdef01', accounts: [] })],
      ['bad install id', JSON.stringify({ version: 1, installId: 'XYZ', accounts: [] })],
      ['accounts missing', JSON.stringify({ version: 1, installId: 'abcdef01' })],
      [
        'record with unknown state',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('a'), state: 'weird' }],
        }),
      ],
      [
        'record with bad id',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('a'), id: 'A!' }],
        }),
      ],
      [
        'hostname not of the id',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('a'), hostname: 'b.agents.example.test' }],
        }),
      ],
      [
        'missing limits',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('a'), limits: undefined }],
        }),
      ],
      [
        'hostname with an injected line',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('alice'), hostname: 'alice.evil.example\n}\nimport /etc/x {' }],
        }),
      ],
      [
        'hostname with no domain',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('alice'), hostname: 'alice.' }],
        }),
      ],
      [
        'hostname with a space',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('alice'), hostname: 'alice.a b' }],
        }),
      ],
      [
        'hostname in uppercase',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('alice'), hostname: 'alice.Example.Test' }],
        }),
      ],
      [
        'image with a space',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('alice'), image: 'bad image' }],
        }),
      ],
      [
        'image with a newline',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [{ ...record('alice'), image: 'img\nx' }],
        }),
      ],
      [
        'duplicate id',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [record('a', 0), record('a', 1)],
        }),
      ],
      [
        'duplicate slot',
        JSON.stringify({
          version: 1,
          installId: 'abcdef01',
          accounts: [record('a', 0), record('b', 0)],
        }),
      ],
    ];
    for (const [label, text] of cases) {
      const dir = await tempDir();
      await writeFile(join(dir, 'accounts.json'), text, { mode: 0o600 });
      await expect(AccountStore.open(dir), label).rejects.toMatchObject({ code: 'store-corrupt' });
    }
  });

  it.runIf(unix)('refuses a store that other users can read', async () => {
    const dir = await tempDir();
    await AccountStore.open(dir);
    await chmod(join(dir, 'accounts.json'), 0o644);
    await expect(AccountStore.open(dir)).rejects.toMatchObject({ code: 'store-corrupt' });
  });
});

describe('atomic writes', () => {
  it('replaces the whole file and leaves no temporary file', async () => {
    const dir = await tempDir();
    const path = join(dir, 'f.json');
    await writeFileAtomic(path, 'one');
    await writeFileAtomic(path, 'two');
    expect(await readFile(path, 'utf8')).toBe('two');
    expect((await readdir(dir)).sort()).toEqual(['f.json']);
  });

  it.runIf(unix && process.getuid?.() !== 0)(
    'keeps the old content when the write cannot start',
    async () => {
      const dir = await tempDir();
      const path = join(dir, 'f.json');
      await writeFileAtomic(path, 'old');
      await chmod(dir, 0o500);
      try {
        await expect(writeFileAtomic(path, 'new')).rejects.toThrow();
      } finally {
        await chmod(dir, 0o700);
      }
      expect(await readFile(path, 'utf8')).toBe('old');
      expect((await readdir(dir)).sort()).toEqual(['f.json']);
    },
  );

  it('removes its temporary file when the rename fails', async () => {
    const dir = await tempDir();
    const target = join(dir, 'target');
    await mkdir(join(target, 'child'), { recursive: true });
    await expect(writeFileAtomic(target, 'data')).rejects.toThrow();
    expect((await readdir(dir)).sort()).toEqual(['target']);
  });
});

describe('secret store', () => {
  it('writes one 0600 file per account in a 0700 directory and reads it back', async () => {
    const dir = await tempDir();
    const secrets = await SecretStore.open(dir);
    await secrets.writeAccountKey('alice', KEY);
    const path = join(dir, 'secrets', 'alice.json');
    if (unix) {
      expect(await mode(join(dir, 'secrets'))).toBe(0o700);
      expect(await mode(path)).toBe(0o600);
    }
    expect(await secrets.readAccountKey('alice')).toBe(KEY);
    expect(await secrets.hasAccountKey('alice')).toBe(true);
    expect(await secrets.hasAccountKey('bob')).toBe(false);
    await secrets.removeAccountKey('alice');
    await secrets.removeAccountKey('alice');
    expect(await secrets.readAccountKey('alice')).toBeUndefined();
  });

  it('keeps keys out of the account store file', async () => {
    const dir = await tempDir();
    const store = await AccountStore.open(dir);
    const secrets = await SecretStore.open(dir);
    await store.put(record('alice'));
    await secrets.writeAccountKey('alice', KEY);
    expect(await readFile(join(dir, 'accounts.json'), 'utf8')).not.toContain(KEY);
  });

  it('refuses a damaged or too-open secret file', async () => {
    const dir = await tempDir();
    const secrets = await SecretStore.open(dir);
    await writeFile(join(dir, 'secrets', 'alice.json'), '{"version":9}', { mode: 0o600 });
    await expect(secrets.readAccountKey('alice')).rejects.toMatchObject({ code: 'store-corrupt' });
    if (unix) {
      await secrets.writeAccountKey('bob', KEY);
      await chmod(join(dir, 'secrets', 'bob.json'), 0o644);
      await expect(secrets.readAccountKey('bob')).rejects.toMatchObject({ code: 'store-corrupt' });
    }
  });

  it('resolves unit secrets by key source', async () => {
    const dir = await tempDir();
    const secrets = await SecretStore.open(dir);
    await secrets.writeAccountKey('alice', KEY);
    expect(await secrets.resolve(record('alice'))).toEqual({ modelApiKey: KEY });
    expect(await secrets.resolve({ ...record('alice'), keySource: 'none' })).toEqual({});
    await expect(
      secrets.resolve({ ...record('alice'), keySource: 'operator' }),
    ).rejects.toMatchObject({
      code: 'secret-missing',
    });
    await secrets.writeOperatorKey('operator-key-123');
    expect(await secrets.resolve({ ...record('alice'), keySource: 'operator' })).toEqual({
      modelApiKey: 'operator-key-123',
    });
    await expect(secrets.resolve(record('bob'))).rejects.toMatchObject({ code: 'secret-missing' });
  });

  it('refuses account ids that could leave the directory', async () => {
    const secrets = await SecretStore.open(await tempDir());
    await expect(secrets.writeAccountKey('../escape', KEY)).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });
});

describe('audit log', () => {
  it('appends JSON lines in a 0600 file with the documented fields', async () => {
    const dir = await tempDir();
    const path = join(dir, 'audit.log');
    const log = await AuditLog.open(path);
    await log.append({ actor: 'op', command: 'add', account: 'alice', result: 'ok', reason: null });
    await log.append({
      actor: 'op',
      command: 'list',
      account: null,
      result: 'refused',
      reason: 'why',
    });
    const lines = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0])).toEqual([
      'ts',
      'actor',
      'command',
      'account',
      'result',
      'reason',
    ]);
    expect(lines[1]).toMatchObject({ account: null, result: 'refused', reason: 'why' });
    if (unix) expect(await mode(path)).toBe(0o600);
  });
});
