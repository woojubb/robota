/**
 * A running session whose record something it cannot verify changed on disk.
 *
 * The store will not save the session's id over such a file: merging it would hand the session
 * content nobody vouched for, and overwriting it would destroy what may be another process's newer
 * work. So the session stops acting on its own, saves its state once under a new id as the owner's,
 * says which id that is, and leaves the changed file alone. A sealed file the locked keys merely
 * cannot open yet is different — it may be the owner's own other process — so that refusal waits for
 * the unlock and decides then.
 */

import { randomBytes } from 'node:crypto';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { SealedSessionUnreadableError } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionDivergedError } from '../session-divergence.js';
import {
  authorshipOf,
  cleanUpSealedSessionFixtures,
  contentOf,
  directory,
  fileBytes,
  forgeRecord,
  readFresh,
  record,
  savedByAnotherProcess,
  sealedStore,
  sessionOptions,
  started,
  storedIds,
  turn,
} from './helpers/sealed-session-fixtures.js';

import type { TestInteractive } from './helpers/sealed-session-fixtures.js';

const LIVE_TEXT = 'CANARY-3e2-live-work-5a1e';
const PLANTED_TEXT = 'CANARY-3e2-planted-file-0f93';

afterEach(cleanUpSealedSessionFixtures);

/** A turn that may be refused; what it saved and said is the subject, not the refusal. */
async function attempt(session: TestInteractive, prompt: string): Promise<unknown> {
  try {
    await turn(session, prompt);
    return undefined;
  } catch (error) {
    return error;
  }
}

function errorsOf(session: TestInteractive): Error[] {
  const errors: Error[] = [];
  session.on('error', (error) => errors.push(error));
  return errors;
}

function refusalsIn(errors: readonly Error[]): string[] {
  return errors
    .filter(
      (error): error is SealedSessionUnreadableError =>
        error instanceof SealedSessionUnreadableError,
    )
    .map((error) => error.reason);
}

/** A running session over a store that seals, with a name, a plan and a turn of its own. */
async function runningSession(turns = 4, sealer = createTestArtifactSealer()) {
  const cwd = directory();
  const dir = directory();
  const store = sealedStore(dir, sealer);
  const session = await started(
    sessionOptions(
      cwd,
      store,
      { sessionName: 'my work' },
      Array.from({ length: turns }, (_, index) => ({ text: `reply ${index}` })),
    ),
  );
  await session.setPlan('ship the release', ['tag it']);
  await turn(session, LIVE_TEXT);
  return { cwd, dir, sealer, store, session, id: session.sessionId };
}

describe('a running session whose record something unverifiable changed', () => {
  it('saves its whole state once under a new id as the owner’s, names it, and leaves the file', async () => {
    const { cwd, dir, sealer, session, id } = await runningSession();
    const errors = errorsOf(session);
    forgeRecord(dir, sealer, record(id, cwd, PLANTED_TEXT));
    const planted = fileBytes(dir, id);

    await attempt(session, 'the turn whose save is refused');

    const copies = storedIds(dir).filter((stored) => stored !== id);
    expect(copies).toHaveLength(1);
    const copyId = copies[0]!;
    const copy = readFresh(dir, sealer, copyId);
    expect(authorshipOf(copy)).toBe('verified');
    if (copy.status !== 'valid') throw new Error(`expected valid, got ${copy.status}`);
    expect(contentOf(copy)).toContain(LIVE_TEXT);
    expect(contentOf(copy)).not.toContain(PLANTED_TEXT);
    expect(copy.record.plan?.objective).toBe('ship the release');
    expect(copy.record.name).toBe('my work (copy)');
    // The notice names the copy, once, in fixed words.
    const notices = errors.filter((error) => error instanceof SessionDivergedError);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toBe(
      `Session ${id} was changed on disk by something this process cannot verify, so it is no ` +
        `longer saved. Its state up to now is saved as session ${copyId}; resume that id to ` +
        'continue. The changed file was left as it is.',
    );
    expect(JSON.stringify(session.getFullHistory())).toContain(`saved as session ${copyId}`);
    // The changed file is exactly as it was planted.
    expect(fileBytes(dir, id).equals(planted)).toBe(true);
  });

  it('saves its id no more and copies no more, whatever it is asked next', async () => {
    const { cwd, dir, sealer, session, id } = await runningSession(6);
    forgeRecord(dir, sealer, record(id, cwd, PLANTED_TEXT));
    const planted = fileBytes(dir, id);

    await attempt(session, 'refused once');
    const later = await attempt(session, 'refused again');
    expect(() => session.setName('renamed after')).toThrow(`Session ${id} is no longer saved`);
    await session.setPlan('another objective');

    expect((later as Error).message).toBe(
      `Session ${id} is no longer saved: it was changed on disk by something this process ` +
        'cannot verify.',
    );
    expect(storedIds(dir).filter((stored) => stored !== id)).toHaveLength(1);
    expect(fileBytes(dir, id).equals(planted)).toBe(true);
  });

  it('reports a copy that could not be written, and writes it when the session ends', async () => {
    const sealer = createTestArtifactSealer();
    const cwd = directory();
    const dir = directory();
    const inner = sealedStore(dir, sealer);
    let refuseCopies = false;
    // The store refuses the copy the first time: a full disk, a permission, anything.
    const store = Object.assign(Object.create(inner) as typeof inner, {
      save: (...args: Parameters<typeof inner.save>) => {
        if (refuseCopies && args[0].id !== session.sessionId) {
          refuseCopies = false;
          throw new Error('the disk is full');
        }
        inner.save(...args);
      },
    });
    const session = await started(
      sessionOptions(
        cwd,
        store,
        { sessionName: 'my work' },
        Array.from({ length: 4 }, (_, index) => ({ text: `reply ${index}` })),
      ),
    );
    const id = session.sessionId;
    await turn(session, LIVE_TEXT);
    const errors = errorsOf(session);
    forgeRecord(dir, sealer, record(id, cwd, PLANTED_TEXT));
    refuseCopies = true;

    await attempt(session, 'the turn whose save is refused');

    expect(storedIds(dir)).toEqual([id]);
    const notices = errors.filter((error) => error instanceof SessionDivergedError);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toContain('could not be saved as a new session either');
    expect(errors.some((error) => error.message === 'the disk is full')).toBe(true);

    await session.shutdown();

    const copies = storedIds(dir).filter((stored) => stored !== id);
    expect(copies).toHaveLength(1);
    const copy = readFresh(dir, sealer, copies[0]!);
    expect(authorshipOf(copy)).toBe('verified');
    expect(contentOf(copy)).toContain(LIVE_TEXT);
  });

  it('starts nothing on its own any more: no goal, loop or schedule', async () => {
    const { cwd, dir, sealer, session, id } = await runningSession();
    forgeRecord(dir, sealer, record(id, cwd, PLANTED_TEXT));
    await attempt(session, 'the turn whose save is refused');
    const entries = session.getFullHistory().length;

    expect(session.requestWakeup('wake up', 'a-scheduled-task')).toBe(false);
    await expect(session.setGoal('keep going')).rejects.toThrow(`Session ${id} is no longer saved`);
    await expect(session.createSelfPacedLoop('poll the build')).rejects.toThrow(
      `Session ${id} is no longer saved`,
    );
    await expect(
      session.spawnScheduledWake({
        label: 'later',
        cronExpression: '*/5 * * * *',
        agentInstruction: 'check',
      }),
    ).rejects.toThrow(`Session ${id} is no longer saved`);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(session.isExecuting()).toBe(false);
    expect(session.getFullHistory()).toHaveLength(entries);
    expect(session.getGoalState()).toBeNull();
  });
});

describe('a sealed file the locked keys cannot open', () => {
  it('refuses the save without stopping anything, and saving resumes at the unlock when it verifies', async () => {
    const key = randomBytes(32);
    const { cwd, dir, sealer, session, id } = await runningSession(
      6,
      createTestArtifactSealer({ key }),
    );
    const errors = errorsOf(session);
    sealer.lock();
    // The owner's other process, unlocked, saved this session meanwhile: a tagged record.
    savedByAnotherProcess(
      dir,
      createTestArtifactSealer({ key }),
      record(id, cwd, 'written by another of my processes'),
    );

    await attempt(session, 'a turn while locked');

    expect(refusalsIn(errors)).toEqual(['locked']);
    expect(errors.some((error) => error instanceof SessionDivergedError)).toBe(false);
    expect(storedIds(dir)).toEqual([id]);

    sealer.unlock();
    await turn(session, 'a turn after the unlock');

    const stored = readFresh(dir, sealer, id);
    expect(authorshipOf(stored)).toBe('verified');
    expect(contentOf(stored)).toContain('a turn after the unlock');
    expect(storedIds(dir)).toEqual([id]);
    expect(errors.some((error) => error instanceof SessionDivergedError)).toBe(false);
  });

  it('saves the state as a copy when the session ends while the refusal still stands', async () => {
    const { cwd, dir, sealer, session, id } = await runningSession(6);
    sealer.lock();
    // Something holding only the public key sealed bytes over the running session's file.
    forgeRecord(dir, sealer, record(id, cwd, PLANTED_TEXT));
    const planted = fileBytes(dir, id);
    await attempt(session, 'a turn while locked');
    expect(storedIds(dir)).toEqual([id]);

    await session.shutdown();

    const copies = storedIds(dir).filter((stored) => stored !== id);
    expect(copies).toHaveLength(1);
    expect(fileBytes(dir, id).equals(planted)).toBe(true);
    sealer.unlock();
    const copy = readFresh(dir, sealer, copies[0]!);
    expect(contentOf(copy)).toContain(LIVE_TEXT);
    expect(contentOf(copy)).not.toContain(PLANTED_TEXT);
    if (copy.status !== 'valid') throw new Error(`expected valid, got ${copy.status}`);
    expect(copy.record.plan?.objective).toBe('ship the release');
  });

  it('retries the refused save at the unlock itself, and saving resumes when the file verifies', async () => {
    const key = randomBytes(32);
    const { cwd, dir, sealer, session, id } = await runningSession(
      6,
      createTestArtifactSealer({ key }),
    );
    const errors = errorsOf(session);
    sealer.lock();
    savedByAnotherProcess(
      dir,
      createTestArtifactSealer({ key }),
      record(id, cwd, 'written by another of my processes'),
    );
    await attempt(session, 'a turn while locked');
    expect(refusalsIn(errors)).toEqual(['locked']);

    // No turn after this: the unlock alone saves the session again.
    sealer.unlock();

    const stored = readFresh(dir, sealer, id);
    expect(authorshipOf(stored)).toBe('verified');
    expect(contentOf(stored)).toContain(LIVE_TEXT);
    expect(contentOf(stored)).not.toContain('written by another of my processes');
    expect(storedIds(dir)).toEqual([id]);
    expect(errors.some((error) => error instanceof SessionDivergedError)).toBe(false);
  });

  it('is treated as any other change at the unlock when it does not verify', async () => {
    const { cwd, dir, sealer, session, id } = await runningSession(6);
    const errors = errorsOf(session);
    forgeRecord(dir, sealer, record(id, cwd, PLANTED_TEXT));
    sealer.lock();

    await attempt(session, 'a turn while locked');
    expect(refusalsIn(errors)).toEqual(['locked']);
    expect(storedIds(dir)).toEqual([id]);

    sealer.unlock();
    await attempt(session, 'a turn after the unlock');

    expect(errors.filter((error) => error instanceof SessionDivergedError)).toHaveLength(1);
    expect(storedIds(dir).filter((stored) => stored !== id)).toHaveLength(1);
    expect(contentOf(readFresh(dir, sealer, id))).toContain(PLANTED_TEXT);
  });
});
