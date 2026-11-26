/**
 * A served runtime's launch reuses an empty saved session of its workspace unless another process
 * holds that session's writer claim: then it starts a fresh one instead of landing on a session it
 * would be refused. The stores are real plain stores over a temporary directory; a claim another
 * runtime holds is its owner record, left for a process that is running, gone, or on another host.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework/node';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveStartupResume, type IStartupResumeInput } from '../startup-resume.js';

import type { IProcessIdentity } from '@robota-sdk/agent-core';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

const CWD = '/work/project';
const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

/** The identity of the process `pid` as a claim's owner record names it, on this machine. */
function identityOf(pid: number): IProcessIdentity {
  const { startTime: _own, ...here } = readCurrentProcessIdentity();
  const startTime = readProcessStartTime(pid);
  return { ...here, pid, ...(startTime === undefined ? {} : { startTime }) };
}

/** A process other than this one that is running now. */
async function runningProcess(): Promise<IProcessIdentity> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
    stdio: 'ignore',
  });
  children.push(child);
  await new Promise<void>((resolve) => child.once('spawn', () => resolve()));
  return identityOf(child.pid!);
}

/** A process that has exited, as a runtime that was killed leaves behind. */
async function exitedProcess(): Promise<IProcessIdentity> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  children.push(child);
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return identityOf(child.pid!);
}

/** A plain store over a fresh directory holding the empty sessions `ids`, the last one the newest. */
function emptySessions(ids: readonly string[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'startup-claimed-')));
  roots.push(root);
  const dir = join(root, 'sessions');
  const store = createNodeHostSessionStore(dir, { sealing: 'plain' });
  ids.forEach((id, index) =>
    store.save({
      id,
      cwd: CWD,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: `2026-11-01T0${index + 1}:00:00.000Z`,
      messages: [],
    }),
  );
  /** Leaves the writer claim of session `id` held by `owner`; returns the claim's file. */
  const hold = (id: string, owner: IProcessIdentity): string =>
    leaveProcessMarker(join(dir, 'claims'), id, owner);
  return { store, hold };
}

function launchOver(store: IInteractiveSessionStore | undefined) {
  const written: string[] = [];
  const questions: string[] = [];
  const value: IStartupResumeInput = {
    store,
    cwd: CWD,
    continueMode: false,
    resumeId: undefined,
    reuseEmptySession: true,
    interactive: false,
    confirm: async (question) => {
      questions.push(question);
      return false;
    },
    write: (text) => written.push(text),
  };
  return { value, written, questions };
}

const notFound = (idOrName: string): string => `Session not found: ${idOrName}`;

describe('a served runtime’s launch beside another runtime of the workspace', () => {
  it('skips an empty session another live runtime holds, and starts a fresh one', async () => {
    const w = emptySessions(['sess_held']);
    const claim = w.hold('sess_held', await runningProcess());
    const before = readFileSync(claim);
    const run = launchOver(w.store);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'start' });

    // Deciding only looks: the other runtime's claim is neither taken nor touched, and nothing is asked.
    expect(readFileSync(claim).equals(before)).toBe(true);
    expect([...run.written, ...run.questions]).toEqual([]);
  });

  it('reuses a free empty session when a newer one is held', async () => {
    const w = emptySessions(['sess_free', 'sess_held']);
    w.hold('sess_held', await runningProcess());
    const run = launchOver(w.store);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_free',
    });

    // The decision claims nothing: the session the run opens takes its own claim.
    expect(w.store.hasWriter('sess_free')).toBe(false);
  });

  it('starts fresh when every empty session is held', async () => {
    const w = emptySessions(['sess_a', 'sess_b']);
    const owner = await runningProcess();
    w.hold('sess_a', owner);
    w.hold('sess_b', owner);
    const run = launchOver(w.store);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'start' });
  });

  it('skips a session this process itself has claimed', async () => {
    const w = emptySessions(['sess_open_here']);
    const claim = w.store.claim('sess_open_here');
    try {
      const run = launchOver(w.store);

      expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'start' });
    } finally {
      claim.release();
    }
  });

  it('skips a session whose claim cannot be told running: it may be a live runtime elsewhere', async () => {
    const w = emptySessions(['sess_elsewhere']);
    w.hold('sess_elsewhere', { ...identityOf(process.pid), hostname: 'another-host.invalid' });
    const run = launchOver(w.store);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'start' });
  });

  it('reuses the empty session of a runtime that is gone, whose claim is then taken over', async () => {
    const w = emptySessions(['sess_left_behind']);
    w.hold('sess_left_behind', await exitedProcess());
    const run = launchOver(w.store);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_left_behind',
    });
    const claim = w.store.claim('sess_left_behind');
    try {
      expect(claim.holdsWriter?.()).toBe(true);
    } finally {
      claim.release();
    }
  });

  it('starts fresh over a store with no sessions, and with no store', async () => {
    expect(await resolveStartupResume(launchOver(emptySessions([]).store).value, notFound)).toEqual(
      {
        kind: 'start',
      },
    );
    expect(await resolveStartupResume(launchOver(undefined).value, notFound)).toEqual({
      kind: 'start',
    });
  });
});
