/**
 * When a running session's accepted record becomes the owner's, and what a store view cannot switch
 * off (#3679 step 3e).
 *
 * A person who says a record nobody vouched for is theirs names its exact bytes (`acceptedDigest`).
 * The session raises those bytes to the owner's once, and only after it has restored from them: a
 * resume refused after the acceptance, or a copy (`--fork-session`) made from them, leaves the record
 * exactly as it was. A record handed to a subagent that still saves it is never raised under it. And
 * whatever a store view leaves out, an unverified record is never resumed unaccepted.
 */

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

import { isSessionAuthorshipRefusedError } from '../session-authorship-gate.js';
import {
  authorshipOf,
  cleanUpSealedSessionFixtures,
  construct,
  contentOf,
  digestOfFile,
  directory,
  fileBytes,
  forgeRecord,
  readFresh,
  record,
  sealedStore,
  sessionOptions,
  started,
  turn,
} from './helpers/sealed-session-fixtures.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

const FORGED_TEXT = 'CANARY-3e-accept-unverified-6b1d';

afterEach(cleanUpSealedSessionFixtures);

describe('an accepted record', () => {
  it('copied by --fork-session is left exactly as it was, and the copy is the owner’s', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_source', cwd, FORGED_TEXT));
    const before = fileBytes(dir, 'sess_source');
    const store = sealedStore(dir, sealer);

    const fork = await started(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_source',
        acceptedDigest: digestOfFile(dir, 'sess_source'),
        forkSession: true,
      }),
    );
    await turn(fork, 'a turn of the copy');

    expect(fileBytes(dir, 'sess_source').equals(before)).toBe(true);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_source'))).toBe('unverified');
    const copy = readFresh(dir, sealer, fork.sessionId);
    expect(authorshipOf(copy)).toBe('verified');
    expect(contentOf(copy)).toContain(FORGED_TEXT);
  });

  it('is not raised when the host refuses the restored record after the acceptance', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_refused', cwd, FORGED_TEXT));
    const before = fileBytes(dir, 'sess_refused');
    const store = sealedStore(dir, sealer);

    const { session, error } = construct(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_refused',
        acceptedDigest: digestOfFile(dir, 'sess_refused'),
        // What ACP's load does with a record that would start work on its own.
        checkRestoredRecord: () => {
          throw new Error('the host refused the restored record');
        },
      }),
    );

    expect(session).toBeUndefined();
    expect((error as Error).message).toBe('the host refused the restored record');
    expect(fileBytes(dir, 'sess_refused').equals(before)).toBe(true);
    expect(authorshipOf(readFresh(dir, sealer, 'sess_refused'))).toBe('unverified');
  });

  it('is raised once the session restored from it', async () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_resumed', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);

    await started(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_resumed',
        acceptedDigest: digestOfFile(dir, 'sess_resumed'),
      }),
    );

    expect(authorshipOf(readFresh(dir, sealer, 'sess_resumed'))).toBe('verified');
  });
});

describe('a fork record a subagent still saves', () => {
  it('is not resumed under an acceptance, and the subagent’s next save still goes through', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const parent = sealedStore(dir, sealer);
    parent.save(record('sess_fork', cwd, 'the fork as written'), {
      handoff: true,
      provenance: 'owner',
    });
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });
    child.importHeld('sess_fork', parent.exportHeld('sess_fork') as string);
    child.save(record('sess_fork', cwd, 'the child turn'));
    const accepted = digestOfFile(dir, 'sess_fork');

    const { session } = construct(
      sessionOptions(cwd, parent, { resumeSessionId: 'sess_fork', acceptedDigest: accepted }),
    );

    expect(session).toBeUndefined();
    expect(() => child.save(record('sess_fork', cwd, 'the next child turn'))).not.toThrow();
  });
});

describe('a store view without the members a store that seals offers', () => {
  it('never resumes a record nobody vouched for', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_planted', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    // A hand-written decorator that forwards only what every store has.
    const view = {
      save: (value: Parameters<NodeSessionStore['save']>[0]) => store.save(value),
      load: (id: string, options?: Parameters<NodeSessionStore['load']>[1]) =>
        store.load(id, options),
      list: () => store.list(),
      delete: (id: string) => store.delete(id),
    } as unknown as IInteractiveSessionStore;

    const { session, error } = construct(
      sessionOptions(cwd, view, { resumeSessionId: 'sess_planted' }),
    );

    expect(session).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(FORGED_TEXT);
  });

  it('refuses an unverified record without an acceptance even when it omits the authorship member', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_planted', cwd, FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const view = {
      save: (...args: Parameters<NodeSessionStore['save']>) => store.save(...args),
      load: (...args: Parameters<NodeSessionStore['load']>) => store.load(...args),
      list: () => store.list(),
      delete: (id: string) => store.delete(id),
      claim: (...args: Parameters<NonNullable<NodeSessionStore['claim']>>) => store.claim!(...args),
    } as unknown as IInteractiveSessionStore;

    const { session, error } = construct(
      sessionOptions(cwd, view, { resumeSessionId: 'sess_planted' }),
    );

    expect(session).toBeUndefined();
    expect(isSessionAuthorshipRefusedError(error)).toBe(true);
    expect(error).toMatchObject({ reason: 'unverified' });
  });
});
