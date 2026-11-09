/**
 * Fixtures for the tests of a running session over a store that seals: records the
 * owner wrote (tagged), records something else wrote with the public key only (untagged), and a
 * session that exposes its initialization.
 */

import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { SESSION_RECORD_ENVELOPE_VERSION, isSessionClaimedError } from '@robota-sdk/agent-session';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';

import { InteractiveSession } from '../../interactive-session.js';
import { createTestFrameworkHost } from '../../../testing/framework-host.js';

import type { TScriptedTurn, IArtifactSealerDouble } from '@robota-sdk/agent-core/testing';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface/session';
import type { TInteractiveSessionOptions } from '../../interactive-session.js';

const testHost = createTestFrameworkHost();

/** Exposes initialization, which a host awaits through `whenInitialized`. */
export class TestInteractive extends InteractiveSession {
  ready(): Promise<void> {
    return this.ensureInitialized();
  }
}

const directories: string[] = [];
const closers: Array<() => Promise<void>> = [];

/** Runs after each test: shuts every session down and removes every directory. */
export async function cleanUpSealedSessionFixtures(): Promise<void> {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
}

export function directory(prefix = 'framework-claims-'): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  directories.push(value);
  return value;
}

export function sealedStore(dir: string, sealer: IArtifactSealerDouble): NodeSessionStore {
  return new NodeSessionStore(dir, { sealing: { sealer } });
}

/**
 * `value` saved over session `value.id`'s file in `dir` by another of the owner's processes, past the
 * writer marker this process's session holds: what a process that keeps no marker, or a same-user
 * program, could write. Saved by `sealer` elsewhere and copied into place.
 */
export function savedByAnotherProcess(
  dir: string,
  sealer: IArtifactSealerDouble,
  value: IInteractiveSessionRecord,
): void {
  const elsewhere = directory();
  sealedStore(elsewhere, sealer).save(value, { provenance: 'owner' });
  writeFileSync(join(dir, `${value.id}.json`), readFileSync(join(elsewhere, `${value.id}.json`)));
}

export function record(
  id: string,
  cwd: string,
  text: string,
  extra: Partial<IInteractiveSessionRecord> = {},
): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:10:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-11-01T00:01:00.000Z'),
        state: 'complete',
      },
      {
        id: 'm-1',
        role: 'assistant',
        content: `an answer to ${text}`,
        timestamp: new Date('2026-11-01T00:02:00.000Z'),
        state: 'complete',
      },
    ],
    history: [],
    ...extra,
  };
}

/** `value` written by the owner's unlocked process in another store instance: tagged, so verified. */
export function writeOwnerRecord(
  dir: string,
  sealer: IArtifactSealerDouble,
  value: IInteractiveSessionRecord,
): void {
  sealedStore(dir, sealer).save(value, { provenance: 'owner' });
}

/** `value` sealed by something holding only the public key (a write grant): untagged, so unverified. */
export function forgeRecord(
  dir: string,
  sealer: IArtifactSealerDouble,
  value: IInteractiveSessionRecord,
): void {
  const writeOnly = openTestWriteGrant(sealer.writeGrant());
  const envelope = JSON.stringify(
    { schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record: value },
    null,
    2,
  );
  writeFileSync(
    join(dir, `${value.id}.json`),
    writeOnly.sealBytes(Buffer.from(envelope), { kind: 'session-record', id: value.id }),
  );
}

export function fileBytes(dir: string, id: string): Buffer {
  return readFileSync(join(dir, `${id}.json`));
}

export function digestOfFile(dir: string, id: string): string {
  return createHash('sha256').update(fileBytes(dir, id)).digest('hex');
}

/** The session ids a directory holds a record for. */
export function storedIds(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

/** What a restarted process (a fresh store instance) reads for `id`. */
export function readFresh(
  dir: string,
  sealer: IArtifactSealerDouble,
  id: string,
): TSessionLoadOutcome {
  return sealedStore(dir, sealer).load(id);
}

export function authorshipOf(outcome: TSessionLoadOutcome): string {
  return outcome.status === 'valid' ? (outcome.authorship ?? 'none') : outcome.status;
}

export function contentOf(outcome: TSessionLoadOutcome): string {
  return outcome.status === 'valid' ? JSON.stringify(outcome.record.messages) : outcome.status;
}

/** Whether `store` would let another session claim `id` now; the probe claim is let go at once. */
export function claimable(store: IInteractiveSessionStore, id: string): boolean {
  try {
    store.claim(id).release();
    return true;
  } catch (error) {
    if (isSessionClaimedError(error)) return false;
    throw error;
  }
}

export function sessionOptions(
  cwd: string,
  store: IInteractiveSessionStore,
  extra: Partial<TInteractiveSessionOptions> = {},
  turns: readonly TScriptedTurn[] = [{ text: 'a fresh reply' }],
): TInteractiveSessionOptions {
  return {
    host: testHost,
    cwd,
    sessionStore: store,
    provider: createScriptedProvider(turns).provider,
    bare: true,
    defaultTools: [],
    ...extra,
  } as TInteractiveSessionOptions;
}

/** Builds a session and shuts it down after the test; a construction that throws returns the error. */
export function construct(options: TInteractiveSessionOptions): {
  readonly session?: TestInteractive;
  readonly error?: unknown;
} {
  try {
    const session = new TestInteractive(options);
    closers.push(() => session.shutdown());
    return { session };
  } catch (error) {
    return { error };
  }
}

/** Builds a session that must construct, and waits for it to start. */
export async function started(options: TInteractiveSessionOptions): Promise<TestInteractive> {
  const { session, error } = construct(options);
  if (session === undefined) throw error;
  await session.ready();
  return session;
}

/** Runs one turn to its end. */
export async function turn(session: InteractiveSession, prompt: string): Promise<void> {
  const handle = await session.submit(prompt);
  await handle.completed;
}
