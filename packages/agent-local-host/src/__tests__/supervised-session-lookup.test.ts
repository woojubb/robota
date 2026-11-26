import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SupervisedSessionNotFoundError, readRegisteredProcessStartTime, sessionDirectory, verifyLiveOwner,
} from '../supervised-control-carrier.js';
import {
  lockSupervisedSession, openSupervisedAttachSocket, stopStartedSupervisedSession, stopSupervisedSession,
} from '../supervised-control-client.js';
import { FIXTURE_GENERATION, startControlEndpoint, writeRegistration, type IControlEndpoint } from './helpers/control-endpoint.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const GENERATION = FIXTURE_GENERATION;
const NOT_FOUND = `No supervised session ${ID} exists.`;

let root: string;
const endpoints: IControlEndpoint[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lk-')));
});

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) await endpoint.close();
  rmSync(root, { recursive: true, force: true });
});

/** What a person reads: the sentence, never a place on this machine. */
function expectPlainSentence(error: unknown, sentence: string): void {
  expect(error).toBeInstanceOf(Error);
  const { message } = error as Error;
  expect(message).toBe(sentence);
  expect(message).not.toContain(root);
  expect(message).not.toContain(tmpdir());
  expect(message).not.toMatch(/[\\/]/u);
  expect((error as NodeJS.ErrnoException).code).toBeUndefined();
}

function lookup(target: string, expectedGeneration?: string, under: string = root): unknown {
  try {
    verifyLiveOwner(under, target, expectedGeneration);
  } catch (error) {
    return error;
  }
  throw new Error('The lookup was expected to refuse.');
}

/** A registered process that has exited: its recorded start can no longer be read back. */
async function exitedProcessStart(): Promise<{ readonly pid: number; readonly startedAt: string }> {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
  const pid = child.pid!;
  const startedAt = readRegisteredProcessStartTime(pid);
  if (startedAt === undefined) throw new Error('Cannot establish the fixture process identity.');
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
  return { pid, startedAt };
}

describe('registration lookup of a well-formed id that is not registered', () => {
  it('says no such supervised session exists when the supervised directory itself is missing', () => {
    const missing = join(root, 'never-created');
    expectPlainSentence(lookup(ID, undefined, missing), NOT_FOUND);
    expect(lookup(ID, undefined, missing)).toBeInstanceOf(SupervisedSessionNotFoundError);
  });

  it('says so when the supervised directory exists and holds no registration for the id', () => {
    expectPlainSentence(lookup(ID), NOT_FOUND);
    writeRegistration(root, '9bf9bc27-d773-4e88-b88f-f7a43e9eb1f4', { id: '9bf9bc27-d773-4e88-b88f-f7a43e9eb1f4' });
    expectPlainSentence(lookup(ID), NOT_FOUND);
  });

  it('says so when the registration directory holds no record, as it does while a runtime leaves', () => {
    mkdirSync(sessionDirectory(root, ID), { mode: 0o700 });
    expectPlainSentence(lookup(ID), NOT_FOUND);
  });

  it('names the id it was asked about', () => {
    const other = '9bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    expectPlainSentence(lookup(other), `No supervised session ${other} exists.`);
    expect((lookup(other) as SupervisedSessionNotFoundError).id).toBe(other);
  });

  it.each<[string, (target: string) => Promise<unknown>]>([
    ['stop', (target) => stopSupervisedSession(target, root)],
    ['stop of a runtime this process started', (target) => stopStartedSupervisedSession(target, root, GENERATION)],
    ['lock', (target) => lockSupervisedSession(target, root, GENERATION)],
    ['attach', (target) => openSupervisedAttachSocket(target, 'drive', root)],
  ])('is the sentence every control entry point gives: %s', async (_name, run) => {
    const error = await run(ID).then(() => undefined, (rejection: unknown) => rejection);
    expectPlainSentence(error, NOT_FOUND);
  });
});

describe('registration lookup refusals that are not a missing registration', () => {
  it.each(['../escape', 'not-a-session-id', ID.toUpperCase(), '8bf9bc27-d773-1e88-b88f-f7a43e9eb1f4', ''])(
    'refuses %j as an invalid id before reading anything',
    (target) => {
      expectPlainSentence(lookup(target), 'Invalid supervised session ID.');
    },
  );

  it('refuses a registration that changed since it was listed', async () => {
    endpoints.push(await startControlEndpoint({ root, id: ID, answer: () => undefined }));
    expectPlainSentence(lookup(ID, 'B'.repeat(22)), 'Supervised session changed since it was listed.');
    expect(lookup(ID, 'B'.repeat(22))).not.toBeInstanceOf(SupervisedSessionNotFoundError);
    expect(verifyLiveOwner(root, ID, GENERATION).generation).toBe(GENERATION);
  });

  it('refuses a registration whose process has exited, and one whose recorded start does not match', async () => {
    const dead = await exitedProcessStart();
    const directory = writeRegistration(root, ID, { id: ID, pid: dead.pid, startedAt: dead.startedAt, generation: GENERATION });
    expectPlainSentence(lookup(ID), 'Supervised session is not proven alive.');
    rmSync(directory, { recursive: true, force: true });
    writeRegistration(root, ID, { id: ID, pid: process.pid, startedAt: 'another start', generation: GENERATION });
    expectPlainSentence(lookup(ID), 'Supervised session is not proven alive.');
  });

  it('refuses a registration that names no generation', () => {
    const startedAt = readRegisteredProcessStartTime(process.pid)!;
    writeRegistration(root, ID, { id: ID, pid: process.pid, startedAt });
    expectPlainSentence(lookup(ID), 'Supervised session registration cannot be controlled.');
  });

  it('refuses a record that is not a valid registration instead of calling it absent', () => {
    writeRegistration(root, ID, { id: ID });
    expectPlainSentence(lookup(ID), 'Supervised session record is invalid.');
  });

  it.skipIf(process.platform === 'win32')('refuses a registration directory others can reach instead of calling it absent', () => {
    const directory = sessionDirectory(root, ID);
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(directory, 'state.json'), '{}', { mode: 0o600 });
    // A mode given to mkdir is cut by the umask, so the directory is opened up afterwards.
    chmodSync(directory, 0o755);
    expectPlainSentence(lookup(ID), 'Supervised session directory is not private to this user.');
  });
});
