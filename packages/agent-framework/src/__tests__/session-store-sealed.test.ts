/**
 * Sealed session records in the PROJECT store (#3679, secure conversation): what the trust-gated
 * adapter writes and concludes when it is given an artifact sealer. The user's directory store has
 * the same cases in agent-session; the two share one codec, and this proves the project adapter
 * routes through it rather than around it.
 *
 * ARCH-047: a project write needs the Linux stable-root host, so the cases that write are Linux-only
 * like the rest of this adapter's tests; the cases that only read run everywhere.
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { SealedSessionUnreadableError, loadSessionForUpdate } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WorkspaceSessionLogSink,
  createProjectSessionStore,
} from '../interactive/session-persistence.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-5d09ab-secret-project-conversation';
const linux = process.platform === 'linux';

function record(id: string, text = CANARY, updatedAt = '2026-08-01T01:00:00.000Z') {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  } satisfies IInteractiveSessionRecord;
}

/**
 * A valid outcome as a store that seals reports it (#3679 step 3e): it says whose the record is and
 * which stored bytes it came from. Saves here state no provenance, and a write-only child's handed-over
 * record is never the owner's, so the records are unverified.
 */
function sealedValid(value: IInteractiveSessionRecord) {
  return {
    status: 'valid',
    record: value,
    authorship: 'unverified',
    digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  };
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'agent-project-sealed-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const fileOf = (id: string): string => join(cwd, '.agent', 'sessions', `${id}.json`);
/** What a store that seals nothing says about a sealed file: there, and no key here opens it. */
const NO_KEYS = { status: 'locked', reason: 'no-keys' } as const;

async function storage(): Promise<{
  readonly sessions: ReturnType<typeof getWorkspaceProjectStateStorage>;
  readonly logs: ReturnType<typeof getWorkspaceProjectStateStorage>;
}> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return {
    sessions: getWorkspaceProjectStateStorage(access.authority, 'sessions'),
    logs: getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
  };
}

type TSealer = ReturnType<typeof createTestArtifactSealer>;

async function storeWith(sealer: TSealer | undefined) {
  const { sessions, logs } = await storage();
  return createProjectSessionStore(sessions, logs, {
    sealing: sealer === undefined ? 'plain' : { sealer },
  });
}

describe.runIf(linux)('the project store with a sealer', () => {
  it('writes a framed, opaque, owner-only file and reads the record back', async () => {
    const store = await storeWith(createTestArtifactSealer());
    store.save(record('sess_a'));

    const bytes = readFileSync(fileOf('sess_a'));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(bytes.includes(Buffer.from(CANARY))).toBe(false);
    expect(statSync(fileOf('sess_a')).mode & 0o777).toBe(0o600);
    expect(store.load('sess_a')).toEqual(sealedValid(record('sess_a')));
  });

  it('seals the same record to different bytes every time', async () => {
    const store = await storeWith(createTestArtifactSealer());
    store.save(record('sess_a'));
    const first = readFileSync(fileOf('sess_a'));
    store.save(record('sess_a'));
    expect(readFileSync(fileOf('sess_a')).equals(first)).toBe(false);
  });

  it('reports locked while the keys are locked, lists nothing, counts the sealed sessions', async () => {
    const sealer = createTestArtifactSealer();
    const store = await storeWith(sealer);
    store.save(record('sess_a'));
    store.save(record('sess_b'));
    sealer.lock();

    expect(store.load('sess_a')).toEqual({ status: 'locked' });
    expect(store.list()).toEqual([]);
    expect(store.scan?.().locked).toBe(2);
  });

  it('writes a NEW session while locked and reads it after the unlock', async () => {
    const sealer = createTestArtifactSealer({ locked: true });
    const store = await storeWith(sealer);
    store.save(record('sess_new'));
    expect(readFileSync(fileOf('sess_new')).includes(Buffer.from(CANARY))).toBe(false);
    expect(store.load('sess_new')).toEqual({ status: 'locked' });

    sealer.unlock();
    expect(store.load('sess_new')).toEqual(sealedValid(record('sess_new')));
  });

  it('does not rebuild a locked session from its replay log', async () => {
    const sealer = createTestArtifactSealer();
    const { sessions, logs } = await storage();
    const store = createProjectSessionStore(sessions, logs, { sealing: { sealer } });
    store.save(record('sess_a'));
    new WorkspaceSessionLogSink(logs, { sealing: 'plain' }).append(
      'sess_a',
      [
        JSON.stringify({
          schemaVersion: 1,
          timestamp: '2026-08-01T00:00:00.000Z',
          sessionId: 'sess_a',
          event: 'session_init',
          cwd,
          provider: 'scripted',
          model: 'scripted',
          systemPrompt: '',
          systemPromptLength: 0,
          toolSchemas: [],
        }),
        JSON.stringify({
          schemaVersion: 1,
          timestamp: '2026-08-01T00:00:01.000Z',
          sessionId: 'sess_a',
          event: 'history_mutation',
          mutation: 'append_message',
          index: 0,
          message: {
            id: 'u1',
            role: 'user',
            content: 'from the log',
            state: 'complete',
            timestamp: '2026-08-01T00:00:01.000Z',
          },
        }),
      ].join('\n') + '\n',
    );
    sealer.lock();

    expect(store.load('sess_a')).toEqual({ status: 'locked' });
    // The log is a recovery for an ABSENT snapshot; this one is present, so the listing neither
    // shows a partial reconstruction of it nor counts it twice.
    expect(store.list()).toEqual([]);
    expect(store.scan?.().locked).toBe(1);
  });

  it('reports a sealed file copied to another id, or tampered, as corrupt', async () => {
    const store = await storeWith(createTestArtifactSealer());
    store.save(record('sess_a'));
    copyFileSync(fileOf('sess_a'), fileOf('sess_b'));
    expect(store.load('sess_b').status).toBe('corrupt');

    const bytes = readFileSync(fileOf('sess_a'));
    bytes[bytes.length - 1] ^= 0x01;
    writeFileSync(fileOf('sess_a'), bytes);
    const outcome = store.load('sess_a');
    if (outcome.status !== 'corrupt') throw new Error(`expected corrupt, got ${outcome.status}`);
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
  });

  it('lists a plaintext record beside sealed ones and seals it the next time it is saved', async () => {
    const store = await storeWith(createTestArtifactSealer());
    store.save(record('sess_new'));
    const legacy = JSON.stringify({ schemaVersion: 2, record: record('sess_old') }, null, 2);
    writeFileSync(fileOf('sess_old'), legacy, 'utf-8');

    expect(
      store
        .list()
        .map((entry) => [entry.id, entry.outcome.status])
        .sort(),
    ).toEqual([
      ['sess_new', 'valid'],
      ['sess_old', 'valid'],
    ]);
    expect(readFileSync(fileOf('sess_old'), 'utf-8')).toBe(legacy);
    store.save(record('sess_old', 'edited'));
    expect(readFileSync(fileOf('sess_old')).subarray(0, 4).toString('ascii')).toBe('RSL1');
  });

  it('deletes a sealed session without keys', async () => {
    const sealer = createTestArtifactSealer();
    const store = await storeWith(sealer);
    store.save(record('sess_a'));
    sealer.lock();
    store.delete('sess_a');
    expect(store.load('sess_a')).toEqual({ status: 'missing' });
  });

  it('refuses to overwrite a sealed session it cannot open, leaving it byte-identical', async () => {
    const sealer = createTestArtifactSealer();
    const store = await storeWith(sealer);
    store.save(record('sess_a'));
    sealer.lock();
    const before = readFileSync(fileOf('sess_a'));

    // A restarted process, and one with no keys at all: neither wrote that file.
    const restarted = await storeWith(sealer);
    expect(() => restarted.save(record('sess_a', 'replacement'))).toThrow(
      SealedSessionUnreadableError,
    );
    const unsealed = await storeWith(undefined);
    expect(() => unsealed.save(record('sess_a', 'replacement'))).toThrow(
      SealedSessionUnreadableError,
    );
    expect(readFileSync(fileOf('sess_a')).equals(before)).toBe(true);
  });

  it('keeps saving a session it created while locked, and one it loaded before the lock', async () => {
    const sealer = createTestArtifactSealer({ locked: true });
    const store = await storeWith(sealer);
    store.save(record('sess_new', 'first'));
    const first = readFileSync(fileOf('sess_new'));
    store.save(record('sess_new', 'second'));
    expect(readFileSync(fileOf('sess_new')).equals(first)).toBe(false);

    sealer.unlock();
    const loaded = await storeWith(sealer);
    loaded.save(record('sess_old'));
    expect(loaded.load('sess_old').status).toBe('valid');
    sealer.lock();
    const before = readFileSync(fileOf('sess_old'));
    loaded.save(record('sess_old', 'after the lock'));
    expect(readFileSync(fileOf('sess_old')).equals(before)).toBe(false);
    expect(loaded.loadHeld?.('sess_old')).toEqual(
      sealedValid(record('sess_old', 'after the lock')),
    );
  });

  it('does not overwrite a file another writer replaced after the lock, and forgets on delete', async () => {
    const sealer = createTestArtifactSealer();
    const store = await storeWith(sealer);
    store.save(record('sess_a'));
    sealer.lock();
    const theirs = sealer.sealBytes(Buffer.from('another writer'), {
      kind: 'session-record',
      id: 'sess_a',
    });
    writeFileSync(fileOf('sess_a'), theirs);

    const thrown = (() => {
      try {
        store.save(record('sess_a', 'mine'));
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(thrown).toBeInstanceOf(SealedSessionUnreadableError);
    expect((thrown as SealedSessionUnreadableError).reason).toBe('changed');
    expect(readFileSync(fileOf('sess_a')).equals(Buffer.from(theirs))).toBe(true);
    // Still held, and no longer what is there: a writer is told it changed, not that keys are locked.
    expect(store.loadHeld?.('sess_a')).toEqual({ status: 'locked', reason: 'changed' });

    sealer.unlock();
    store.save(record('sess_b'));
    sealer.lock();
    store.delete('sess_b');
    expect(store.loadHeld?.('sess_b')).toBeUndefined();
  });
});

/** A sealed-looking file larger than the project read limit, which no store can read back. */
function writeOversized(id: string): Buffer {
  const directory = join(cwd, '.agent', 'sessions');
  mkdirSync(directory, { recursive: true });
  const bytes = Buffer.concat([Buffer.from('RSL1', 'ascii'), Buffer.alloc(4 * 1024 * 1024 + 1, 7)]);
  writeFileSync(join(directory, `${id}.json`), bytes);
  return bytes;
}

function writeRaw(id: string, bytes: Uint8Array | string): void {
  const directory = join(cwd, '.agent', 'sessions');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${id}.json`), bytes);
}

describe('a project session file the store cannot read back', () => {
  it('loads an over-limit file as corrupt with a fixed message instead of throwing', async () => {
    writeOversized('sess_big');
    for (const sealer of [undefined, createTestArtifactSealer()]) {
      const store = await storeWith(sealer);
      expect(store.load('sess_big')).toEqual({
        status: 'corrupt',
        issues: [{ path: '', message: 'the session file is larger than this store reads' }],
      });
      expect(store.list().map((entry) => [entry.id, entry.outcome.status])).toEqual([
        ['sess_big', 'corrupt'],
      ]);
    }
  });

  it.runIf(linux)(
    'refuses to replace an over-limit file when it seals, leaving it as it was',
    async () => {
      const before = writeOversized('sess_big');
      const store = await storeWith(createTestArtifactSealer());

      const thrown = (() => {
        try {
          store.save(record('sess_big'));
        } catch (error) {
          return error;
        }
        return undefined;
      })();

      expect(thrown).toBeInstanceOf(SealedSessionUnreadableError);
      expect((thrown as SealedSessionUnreadableError).reason).toBe('unreadable');
      expect(readFileSync(fileOf('sess_big')).equals(before)).toBe(true);
    },
  );
});

describe('a project record answers only for the id it is stored under', () => {
  it('reports a plain or sealed record that names another session as corrupt', async () => {
    const sealer = createTestArtifactSealer();
    writeRaw('sess_b', JSON.stringify({ schemaVersion: 2, record: record('sess_a') }, null, 2));
    writeRaw(
      'sess_c',
      sealer.sealBytes(
        Buffer.from(JSON.stringify({ schemaVersion: 2, record: record('sess_a') })),
        { kind: 'session-record', id: 'sess_c' },
      ),
    );
    const store = await storeWith(sealer);
    expect(store.load('sess_b').status).toBe('corrupt');
    expect(store.load('sess_c').status).toBe('corrupt');
    expect(JSON.stringify(store.load('sess_c'))).not.toContain(CANARY);
  });
});

describe('a project file sealed in a framing version this build does not know', () => {
  it('is reported as written by a build this one does not read, with or without a sealer', async () => {
    writeRaw('sess_new', Buffer.concat([Buffer.from('RSL2', 'ascii'), Buffer.alloc(64, 3)]));
    for (const sealer of [undefined, createTestArtifactSealer()]) {
      const store = await storeWith(sealer);
      expect(store.load('sess_new')).toEqual({ status: 'unsupported', schemaVersion: undefined });
    }
  });

  it.runIf(linux)('is never replaced, with or without a sealer', async () => {
    const bytes = Buffer.concat([Buffer.from('RSL2', 'ascii'), Buffer.alloc(64, 3)]);
    writeRaw('sess_new', bytes);
    for (const sealer of [undefined, createTestArtifactSealer()]) {
      const store = await storeWith(sealer);
      expect(() => store.save(record('sess_new'))).toThrow(
        expect.objectContaining({ reason: 'newer-format' }),
      );
    }
    expect(readFileSync(fileOf('sess_new')).equals(bytes)).toBe(true);
  });
});

describe('the project store with no sealer is the store it always was', () => {
  it.runIf(linux)('writes the plain pretty-printed envelope, byte for byte', async () => {
    const store = await storeWith(undefined);
    store.save(record('sess_a'));
    expect(readFileSync(fileOf('sess_a'), 'utf-8')).toBe(
      JSON.stringify({ schemaVersion: 2, record: record('sess_a') }, null, 2),
    );
  });

  it.runIf(linux)('reports a sealed file as locked with no keys and counts it apart', async () => {
    (await storeWith(createTestArtifactSealer())).save(record('sess_a'));
    const reader = await storeWith(undefined);
    expect(reader.load('sess_a')).toEqual(NO_KEYS);
    expect(reader.list()).toEqual([]);
    // Counted apart from locked ones, which an unlock would list.
    expect(reader.scan?.()).toEqual({ entries: [], locked: 0, noKeys: 1 });
  });

  it('keeps records plain when it says plain, and refuses a sealing that is missing or is not one (any platform)', async () => {
    const { sessions, logs } = await storage();
    const directory = join(cwd, '.agent', 'sessions');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'sess_a.json'),
      createTestArtifactSealer().sealBytes(Buffer.from('{}'), {
        kind: 'session-record',
        id: 'sess_a',
      }),
    );
    // Plain, so a sealed file is out of reach.
    expect(createProjectSessionStore(sessions, logs, { sealing: 'plain' }).load('sess_a')).toEqual(
      NO_KEYS,
    );
    // What the types refuse, a caller that ignores them is refused at run time as well.
    const stated = createProjectSessionStore as unknown as (...args: unknown[]) => unknown;
    expect(() => stated(sessions, logs)).toThrow(TypeError);
    expect(() => stated(sessions, logs, {})).toThrow(TypeError);
    expect(() => stated(sessions, logs, { sealing: { sealer: undefined } })).toThrow(TypeError);
    expect(() => stated(sessions, logs, 'plain')).toThrow(TypeError);
  });

  it('reads and lists plaintext records (any platform)', async () => {
    const { sessions, logs } = await storage();
    const store = createProjectSessionStore(sessions, logs, { sealing: 'plain' });
    const plaintext = JSON.stringify({ schemaVersion: 2, record: record('sess_a') }, null, 2);
    const directory = join(cwd, '.agent', 'sessions');
    // The writer is Linux-only; a plaintext fixture is made by hand so the READ path is covered here too.
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'sess_a.json'), plaintext, 'utf-8');

    expect(store.load('sess_a')).toEqual({ status: 'valid', record: record('sess_a') });
    expect(store.list().map((entry) => entry.id)).toEqual(['sess_a']);
    expect(store.scan?.().locked).toBe(0);
  });

  it('meets a sealed file as locked, or corrupt under other keys, whether or not this host can write', async () => {
    const sealer = createTestArtifactSealer();
    const { sessions, logs } = await storage();
    const directory = join(cwd, '.agent', 'sessions');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'sess_a.json'),
      sealer.sealBytes(Buffer.from('{}'), { kind: 'session-record', id: 'sess_a' }),
    );

    expect(createProjectSessionStore(sessions, logs, { sealing: 'plain' }).load('sess_a')).toEqual(
      NO_KEYS,
    );
    const otherKeys = createProjectSessionStore(sessions, logs, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    expect(otherKeys.load('sess_a').status).toBe('corrupt');
  });
});

/** A sealed envelope of `record(id)`, made by hand so the read path runs where the writer cannot. */
function writeSealedByHand(sealer: TSealer, id: string): void {
  const directory = join(cwd, '.agent', 'sessions');
  mkdirSync(directory, { recursive: true });
  const envelope = JSON.stringify({ schemaVersion: 2, record: record(id) }, null, 2);
  writeFileSync(
    join(directory, `${id}.json`),
    sealer.sealBytes(Buffer.from(envelope), { kind: 'session-record', id }),
  );
}

describe('a project record handed to a subagent process (#3679 step 3b)', () => {
  it('is exported while unlocked, and nothing while locked with no handoff record', async () => {
    const sealer = createTestArtifactSealer();
    writeSealedByHand(sealer, 'sess_fork');
    const store = await storeWith(sealer);

    const token = store.exportHeld?.('sess_fork');
    sealer.lock();

    expect(token).toMatch(/^rsh2\.(owner|unverified)\.[0-9a-f]{64}\./);
    expect(store.exportHeld?.('sess_fork')).toBeUndefined();
    expect(store.loadHeld?.('sess_fork')).toBeUndefined();
  });

  it('is taken by a write-only store, which then resumes it', async () => {
    const sealer = createTestArtifactSealer();
    writeSealedByHand(sealer, 'sess_fork');
    const token = (await storeWith(sealer)).exportHeld?.('sess_fork') as string;
    const { sessions, logs } = await storage();
    const child = createProjectSessionStore(sessions, logs, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });

    expect(child.load('sess_fork')).toEqual(NO_KEYS);
    child.importHeld?.('sess_fork', token);
    expect(loadSessionForUpdate(child, 'sess_fork')).toEqual(sealedValid(record('sess_fork')));
  });

  it.runIf(linux)(
    'keeps a handoff write apart from the sessions it runs, for one export',
    async () => {
      const sealer = createTestArtifactSealer({ locked: true });
      const store = await storeWith(sealer);
      const held = Array.from({ length: 32 }, (_, index) => `sess_held_${index}`);
      for (const id of held) store.save(record(id));

      store.save(record('sess_fork'), { handoff: true });

      for (const id of held) expect(store.loadHeld?.(id)?.status, id).toBe('valid');
      // An export that keeps it, as a runner's feasibility check does, leaves it for the hand-over.
      expect(store.exportHeld?.('sess_fork', { keep: true })).toMatch(/^rsh2\./);
      expect(store.exportHeld?.('sess_fork')).toMatch(/^rsh2\./);
      expect(store.exportHeld?.('sess_fork')).toBeUndefined();
    },
  );
});
