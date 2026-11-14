/**
 * The process-local sealer: what a process seals for itself alone — its spilled tool results and
 * ephemeral checkpoints — under a key that exists only in its memory. It writes the same framing
 * and binding as the keyring's sealer, so every store reads it with one code path, but its key is
 * not the keyring's: it opens whatever the keyring's lock state, nothing another process (or another
 * instance) sealed opens for it, and no grant can hand its sealing to a child, since a child could
 * never open what it wrote once this process ends.
 */
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ARTIFACT_KEY_REUSE,
  isArtifactCorruptError,
  type IArtifactContext,
  type IArtifactSealer,
  type TArtifactKind,
} from '@robota-sdk/agent-core';
import { NodeToolResultSpillStore } from '@robota-sdk/agent-session/node';
import { ChildProcessSubagentRunner } from '@robota-sdk/agent-subagent-runner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KeyHolderArtifactSealer,
  ProcessLocalArtifactSealer,
  ProcessLocalSealerDisposedError,
} from '@robota-sdk/agent-local-host';
import { KeyHolder } from '@robota-sdk/agent-local-host';
import { FIXTURE_PASSPHRASE, createMemoryKeyringStore, fixtureKeyring } from './helpers.js';

import type { IKeyPair } from '@robota-sdk/agent-keyring';

const generated = vi.hoisted(() => ({ pairs: [] as IKeyPair[] }));
vi.mock('@robota-sdk/agent-keyring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-keyring')>();
  return {
    ...actual,
    generateTransientSealingKeyPair: () => {
      const pair = actual.generateTransientSealingKeyPair();
      generated.pairs.push(pair);
      return pair;
    },
  };
});

const CANARY = 'CANARY-5c19-a-spilled-tool-result';
const spill: IArtifactContext = { kind: 'tool-result-spill', id: 'token_abc' };
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

describe('ProcessLocalArtifactSealer', () => {
  it('round-trips bytes and lines in the framing the keyring sealer writes', () => {
    const sealer = new ProcessLocalArtifactSealer();
    const stored = sealer.sealBytes(Buffer.from(CANARY), spill);
    const line = sealer.sealLine(`${CANARY}\nsecond`, spill);

    expect(Buffer.from(stored).subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(Buffer.from(stored).includes(Buffer.from(CANARY))).toBe(false);
    expect(line.startsWith('RSL1:')).toBe(true);
    expect(line).not.toContain(CANARY);
    expect(sealer.isSealedBytes(stored)).toBe(true);
    expect(sealer.isSealedLine(line)).toBe(true);
    expect(text(sealer.openBytes(stored, spill))).toBe(CANARY);
    expect(sealer.openLine(line, spill)).toBe(`${CANARY}\nsecond`);
  });

  it('gives every artifact of a fresh kind its own data key, so equal plaintext seals apart', () => {
    const sealer = new ProcessLocalArtifactSealer();
    const first = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), spill));
    const second = Buffer.from(sealer.sealBytes(Buffer.from(CANARY), spill));
    // The sealed data key (version, ephemeral public key, IV, wrapped key) leads the blob.
    expect(first.subarray(4, 4 + 93).equals(second.subarray(4, 4 + 93))).toBe(false);
  });

  it('seals only what its own process reads back, refusing any other kind as a defect', () => {
    const sealer = new ProcessLocalArtifactSealer();
    const own: IArtifactContext[] = [
      spill,
      { kind: 'checkpoint-manifest', id: 'session_1:turn-0001' },
      { kind: 'checkpoint-preimage', id: 'session_1:turn-0001:000001' },
    ];
    for (const context of own) {
      const stored = sealer.sealBytes(Buffer.from(CANARY), context);
      expect(text(sealer.openBytes(stored, context)), context.kind).toBe(CANARY);
    }
    const stored = sealer.sealBytes(Buffer.from(CANARY), spill);
    const line = sealer.sealLine(CANARY, spill);
    const others = (Object.keys(ARTIFACT_KEY_REUSE) as TArtifactKind[]).filter(
      (kind) => !own.some((context) => context.kind === kind),
    );

    expect(others).toEqual(
      expect.arrayContaining(['session-record', 'prompt-history-line', 'session-log-line']),
    );
    for (const kind of others) {
      const context: IArtifactContext = { kind, id: spill.id };
      for (const attempt of [
        () => sealer.sealBytes(Buffer.from(CANARY), context),
        () => sealer.sealLine(CANARY, context),
        () => sealer.openBytes(stored, context),
        () => sealer.openLine(line, context),
      ]) {
        expect(attempt, kind).toThrow(RangeError);
      }
    }
  });

  it('binds an artifact to its kind and id', () => {
    const sealer = new ProcessLocalArtifactSealer();
    const stored = sealer.sealBytes(Buffer.from(CANARY), spill);
    for (const wrong of [
      { ...spill, id: 'token_other' },
      { kind: 'checkpoint-preimage', id: spill.id },
    ] as IArtifactContext[]) {
      expect(isArtifactCorruptError(thrown(() => sealer.openBytes(stored, wrong)))).toBe(true);
    }
  });

  it('opens what it sealed while the keyring holder in the same process is locked', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    holder.lock('explicit');
    expect(holder.isUnlocked).toBe(false);

    const sealer = new ProcessLocalArtifactSealer();
    const stored = sealer.sealBytes(Buffer.from(CANARY), spill);
    expect(text(sealer.openBytes(stored, spill))).toBe(CANARY);
  });

  it('is not the keyring: neither opens what the other sealed', async () => {
    const { keyring } = await fixtureKeyring();
    const holder = new KeyHolder({
      store: createMemoryKeyringStore(keyring),
      policy: { idleMs: 0 },
    });
    await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    const owner = new KeyHolderArtifactSealer(holder);
    const local = new ProcessLocalArtifactSealer();

    expect(
      isArtifactCorruptError(
        thrown(() => owner.openBytes(local.sealBytes(Buffer.from(CANARY), spill), spill)),
      ),
    ).toBe(true);
    expect(
      isArtifactCorruptError(
        thrown(() => local.openBytes(owner.sealBytes(Buffer.from(CANARY), spill), spill)),
      ),
    ).toBe(true);
  });

  it('does not open what a second instance sealed: each has a key of its own', () => {
    const first = new ProcessLocalArtifactSealer();
    const second = new ProcessLocalArtifactSealer();
    const stored = first.sealBytes(Buffer.from(CANARY), spill);
    const line = first.sealLine(CANARY, spill);

    expect(isArtifactCorruptError(thrown(() => second.openBytes(stored, spill)))).toBe(true);
    expect(isArtifactCorruptError(thrown(() => second.openLine(line, spill)))).toBe(true);
  });

  it('offers no write grant, so the subagent runner refuses it as a log sealer', () => {
    const sealer: IArtifactSealer = new ProcessLocalArtifactSealer();
    expect('writeGrant' in sealer).toBe(false);
    expect(sealer.writeGrant).toBeUndefined();

    const runner = new ChildProcessSubagentRunner({} as never, {
      workerEntry: { execPath: process.execPath, args: [] },
      providerDefinitions: [],
      worktreeAdapter: {} as never,
      logSealing: { sealer },
    });
    expect(() => runner.preflight({} as never)).toThrow(/cannot hand its sealing to a subagent/);
  });

  it('is terminal once disposed: nothing seals or opens again, and no new key is made', () => {
    const before = generated.pairs.length;
    const sealer = new ProcessLocalArtifactSealer();
    expect(generated.pairs.length).toBe(before + 1);
    const stored = sealer.sealBytes(Buffer.from(CANARY), spill);
    const line = sealer.sealLine(CANARY, spill);

    sealer.dispose();
    sealer.dispose();

    for (const attempt of [
      () => sealer.openBytes(stored, spill),
      () => sealer.openLine(line, spill),
      () => sealer.sealBytes(Buffer.from(CANARY), spill),
      () => sealer.sealLine(CANARY, spill),
    ]) {
      const error = thrown(attempt);
      // A reader takes it as an artifact that does not open, never as locked or as a defect.
      expect(error).toBeInstanceOf(ProcessLocalSealerDisposedError);
      expect(isArtifactCorruptError(error)).toBe(true);
      expect((error as Error).message).toBe(
        'The process-local sealer was disposed; nothing it sealed opens, and it seals nothing more.',
      );
    }
    expect(generated.pairs.length).toBe(before + 1);
    // The framing is still recognised, so a reader still tells sealed from plain.
    expect(sealer.isSealedBytes(stored)).toBe(true);
  });

  it('never puts its private key on disk or in an error', async () => {
    const home = directory('process-local-sealer-home-');
    const sharedTemporary = directory('process-local-sealer-tmp-');
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, sharedTemporary);
    const before = generated.pairs.length;
    const sealer = new ProcessLocalArtifactSealer();
    const pair = generated.pairs[before];
    if (pair === undefined) throw new Error('the sealer made no key');
    const der = Buffer.from(pair.privateKey.export({ format: 'der', type: 'pkcs8' }));
    const raw = der.subarray(der.length - 32);
    const encodings = [
      der,
      raw,
      ...[der, raw].flatMap((bytes) =>
        ['hex', 'base64', 'base64url'].map((encoding) =>
          Buffer.from(bytes.toString(encoding as BufferEncoding), 'latin1'),
        ),
      ),
    ];

    const store = new NodeToolResultSpillStore({
      parentDirectory: home,
      sealing: { sealer },
    });
    const { reference } = await store.write(CANARY);
    expect(await store.read(reference)).toBe(CANARY);
    const corrupt = thrown(() => sealer.openBytes(Buffer.from('RSL1-not-a-blob'), spill));
    sealer.dispose();
    const disposed = thrown(() => sealer.sealBytes(Buffer.from(CANARY), spill));

    const files = [home, sharedTemporary].flatMap(filesUnder);
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const content = readFileSync(file);
      for (const encoding of encodings) expect(content.includes(encoding), file).toBe(false);
    }
    for (const error of [corrupt, disposed] as Error[]) {
      const everything = Buffer.from(
        `${error.name} ${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`,
        'latin1',
      );
      for (const encoding of encodings) expect(everything.includes(encoding)).toBe(false);
      expect(error.cause).toBeUndefined();
    }
    await store.shutdown();
  });
});

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
