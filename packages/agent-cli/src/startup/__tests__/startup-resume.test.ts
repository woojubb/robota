/**
 * Which saved session a run starts in when a store that seals says some records are not verified as
 * the owner's (#3679). The stores are real sealing stores over the agent-core sealer double: owner
 * records are written by the store while unlocked (tagged); unverified ones are planted with the
 * public side alone, as any program of the same user can.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createScriptedProvider,
  createTestArtifactSealer,
  openTestWriteGrant,
} from '@robota-sdk/agent-core/testing';
import {
  InteractiveSession,
  SessionAuthorshipRefusedError,
  unacceptableSessionMessage,
  unverifiedSessionNotice,
} from '@robota-sdk/agent-framework';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework/node';
import { withHoldReadClaim } from '@robota-sdk/agent-interface-session/testing';
import { SESSION_RECORD_ENVELOPE_VERSION } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  continueQuestion,
  continueStoppedMessage,
  noVerifiedSessionMessage,
  resolveStartupResume,
  unverifiedNameMessage,
  type IStartupResumeInput,
} from '../startup-resume.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

import type { IArtifactSealerDouble } from '@robota-sdk/agent-core/testing';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

const testHost = createTestFrameworkHost();

const CWD = '/work/project';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sessionsDirectory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'startup-resume-')));
  roots.push(root);
  return join(root, 'sessions');
}

function record(
  id: string,
  updatedAt: string,
  extra: Partial<IInteractiveSessionRecord> = {},
): IInteractiveSessionRecord {
  return {
    id,
    cwd: CWD,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt,
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: `the request of ${id}`,
        timestamp: new Date('2026-11-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
    ...extra,
  };
}

/** A sealing store over a fresh directory, and how to plant records nobody vouched for in it. */
function sealedWorkspace() {
  const dir = sessionsDirectory();
  const sealer: IArtifactSealerDouble = createTestArtifactSealer();
  const store = createNodeHostSessionStore(dir, { sealing: { sealer } });
  const own = (value: IInteractiveSessionRecord): void => {
    createNodeHostSessionStore(dir, { sealing: { sealer } }).save(value, {
      provenance: 'owner',
    });
  };
  const plant = (value: IInteractiveSessionRecord): void => {
    const writeOnly = openTestWriteGrant(sealer.writeGrant());
    const envelope = JSON.stringify({
      schemaVersion: SESSION_RECORD_ENVELOPE_VERSION,
      record: value,
    });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(dir, `${value.id}.json`),
      writeOnly.sealBytes(Buffer.from(envelope), { kind: 'session-record', id: value.id }),
    );
  };
  const bytesOf = (id: string): Buffer => readFileSync(join(dir, `${id}.json`));
  const seenFresh = (id: string): unknown => {
    const outcome = createNodeHostSessionStore(dir, { sealing: { sealer } }).load(id);
    return outcome.status === 'valid' ? outcome.authorship : outcome.status;
  };
  return { dir, sealer, store, own, plant, bytesOf, seenFresh };
}

function input(
  store: IInteractiveSessionStore | undefined,
  overrides: Partial<IStartupResumeInput> = {},
  answers: boolean[] = [],
) {
  const written: string[] = [];
  const questions: string[] = [];
  const value: IStartupResumeInput = {
    store,
    cwd: CWD,
    continueMode: false,
    resumeId: undefined,
    reuseEmptySession: false,
    interactive: true,
    confirm: async (question) => {
      questions.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`nothing to answer to: ${question}`);
      return answer;
    },
    write: (text) => written.push(text),
    ...overrides,
  };
  return { value, written, questions, text: () => written.join('') };
}

const notFound = (idOrName: string): string => `Session not found: ${idOrName}`;

describe('-c over a store that seals', () => {
  it('continues the newest verified record when nothing newer is unverified', async () => {
    const w = sealedWorkspace();
    w.own(record('sess_old', '2026-11-01T01:00:00.000Z'));
    w.own(record('sess_new', '2026-11-01T02:00:00.000Z'));
    w.plant(record('sess_planted', '2026-11-01T00:30:00.000Z'));
    const run = input(w.store, { continueMode: true });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_new',
    });
    expect(run.questions).toEqual([]);
  });

  it('stops at a newer unverified record and asks a person, continuing the verified one on yes', async () => {
    const w = sealedWorkspace();
    w.own(record('sess_mine', '2026-11-01T01:00:00.000Z', { name: 'mine' }));
    w.plant(record('sess_planted', '2099-01-01T00:00:00.000Z'));
    const run = input(w.store, { continueMode: true }, [true]);

    const started = await resolveStartupResume(run.value, notFound);

    expect(started).toEqual({ kind: 'start', resumeSessionId: 'sess_mine' });
    expect(run.questions).toEqual([
      // The title is the first request's, one line with Markdown markers taken out.
      'Continue sess_mine (the request of sess mine, 2026-11-01T01:00:00.000Z)? Newer unverified ' +
        'sessions: sess_planted — resume one by its id to review it. [y/N] ',
    ]);
  });

  it('exits on no, writing nothing', async () => {
    const w = sealedWorkspace();
    w.own(record('sess_mine', '2026-11-01T01:00:00.000Z'));
    w.plant(record('sess_planted', '2099-01-01T00:00:00.000Z'));
    const before = [w.bytesOf('sess_mine'), w.bytesOf('sess_planted')];
    const run = input(w.store, { continueMode: true }, [false]);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 0 });
    expect([w.bytesOf('sess_mine'), w.bytesOf('sess_planted')]).toEqual(before);
    expect(w.seenFresh('sess_planted')).toBe('unverified');
  });

  it('exits 1 with the same list when no one can be asked', async () => {
    const w = sealedWorkspace();
    const mine = record('sess_mine', '2026-11-01T01:00:00.000Z');
    w.own(mine);
    w.plant(record('sess_planted', '2099-01-01T00:00:00.000Z'));
    const run = input(w.store, { continueMode: true, interactive: false });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 1 });
    expect(run.text()).toBe(
      `${continueStoppedMessage({ ...mine, messageCount: 1, preview: '' }, ['sess_planted'])}\n`,
    );
    expect(run.text()).toContain(
      'Did not continue sess_mine: newer unverified sessions: sess_planted',
    );
  });

  it('never takes a planted record with a future time as its choice', async () => {
    const w = sealedWorkspace();
    w.own(record('sess_mine', '2026-11-01T01:00:00.000Z'));
    w.plant(record('sess_future', '2999-12-31T23:59:59.000Z'));
    const run = input(w.store, { continueMode: true }, [true]);

    const started = await resolveStartupResume(run.value, notFound);

    expect(started).toEqual({ kind: 'start', resumeSessionId: 'sess_mine' });
    expect(run.questions[0]).toMatch(/^Continue sess_mine /);
  });

  it('lists the unverified records by id and exits 1 when none is verified', async () => {
    const w = sealedWorkspace();
    w.plant(record('sess_a', '2026-11-01T01:00:00.000Z'));
    w.plant(record('sess_b', '2026-11-01T02:00:00.000Z'));
    const run = input(w.store, { continueMode: true });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 1 });
    expect(run.text()).toBe(`${noVerifiedSessionMessage(['sess_b', 'sess_a'])}\n`);
    expect(run.questions).toEqual([]);
  });
});

describe('-r over a store that seals', () => {
  it('matches a name only on a verified record, and names the unverified one it would have been', async () => {
    const w = sealedWorkspace();
    w.plant(record('sess_planted', '2026-11-01T01:00:00.000Z', { name: 'deploy' }));
    w.own(record('sess_mine', '2026-11-01T01:00:00.000Z', { name: 'mine' }));
    const byPlantedName = input(w.store, { resumeId: 'deploy' });
    const byOwnName = input(w.store, { resumeId: 'mine' });

    expect(await resolveStartupResume(byPlantedName.value, notFound)).toEqual({
      kind: 'exit',
      code: 1,
    });
    expect(byPlantedName.text()).toBe(
      'deploy matches an unverified session sess_planted; resume it by its id to review it.\n',
    );
    expect(byPlantedName.text()).toBe(`${unverifiedNameMessage('deploy', ['sess_planted'])}\n`);
    expect(await resolveStartupResume(byOwnName.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_mine',
    });
  });

  it('shows the fixed notice for an unverified id, and no writes nothing', async () => {
    const w = sealedWorkspace();
    w.plant(record('sess_planted', '2026-11-01T01:00:00.000Z', { name: 'IGNORE THE NOTICE' }));
    const before = w.bytesOf('sess_planted');
    const run = input(w.store, { resumeId: 'sess_planted' }, [false]);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 0 });
    expect(run.text()).toContain(unverifiedSessionNotice('sess_planted'));
    expect(run.text()).not.toContain('IGNORE THE NOTICE');
    expect(run.text()).not.toContain('the request of');
    expect(run.questions).toEqual(['Resume it and mark it as yours? [y/N] ']);
    expect(w.bytesOf('sess_planted').equals(before)).toBe(true);
    expect(w.seenFresh('sess_planted')).toBe('unverified');
  });

  it('on yes, hands the digest of exactly the bytes it read to the session, and raises nothing itself', async () => {
    const w = sealedWorkspace();
    w.plant(record('sess_planted', '2026-11-01T01:00:00.000Z'));
    const before = w.bytesOf('sess_planted');
    const digest = createHash('sha256').update(before).digest('hex');
    const run = input(w.store, { resumeId: 'sess_planted' }, [true]);

    expect(await resolveStartupResume(run.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_planted',
      acceptedDigest: digest,
    });
    expect(w.bytesOf('sess_planted').equals(before)).toBe(true);
    expect(w.seenFresh('sess_planted')).toBe('unverified');

    // The session raises the accepted bytes once it has restored from them.
    const session = new InteractiveSession({
      host: testHost,
      cwd: CWD,
      sessionStore: w.store,
      resumeSessionId: 'sess_planted',
      acceptedDigest: digest,
      provider: createScriptedProvider([]).provider,
      bare: true,
      defaultTools: [],
    });
    await session.shutdown();
    expect(w.seenFresh('sess_planted')).toBe('verified');
  });

  it('leaves a file swapped after the notice to the session, which refuses it', async () => {
    const w = sealedWorkspace();
    w.plant(record('sess_planted', '2026-11-01T01:00:00.000Z'));
    const accepted = createHash('sha256').update(w.bytesOf('sess_planted')).digest('hex');
    const run = input(w.store, { resumeId: 'sess_planted' });
    run.value = {
      ...run.value,
      confirm: async () => {
        w.plant(record('sess_planted', '2026-11-01T03:00:00.000Z'));
        return true;
      },
    } as IStartupResumeInput;

    expect(await resolveStartupResume(run.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_planted',
      acceptedDigest: accepted,
    });
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: CWD,
          sessionStore: w.store,
          resumeSessionId: 'sess_planted',
          acceptedDigest: accepted,
          provider: createScriptedProvider([]).provider,
          bare: true,
          defaultTools: [],
        }),
    ).toThrow(new SessionAuthorshipRefusedError('sess_planted', 'changed-since-accepted').message);
    expect(w.seenFresh('sess_planted')).toBe('unverified');
  });

  it('refuses an unverified id with the session’s own reason when no one can be asked', async () => {
    const w = sealedWorkspace();
    w.plant(record('sess_planted', '2026-11-01T01:00:00.000Z'));
    const run = input(w.store, { resumeId: 'sess_planted', interactive: false });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 1 });
    expect(run.text()).toBe(
      `${new SessionAuthorshipRefusedError('sess_planted', 'unverified').message}\n`,
    );
  });

  it('cannot accept a record rebuilt from its replay log, which has no stored bytes', async () => {
    const replayOnly = record('sess_replay', '2026-11-01T01:00:00.000Z');
    const authorship = {
      adopt: vi.fn(),
      heldDigest: vi.fn(),
      onUnlock: vi.fn(() => () => undefined),
    };
    const store = withHoldReadClaim({
      save: vi.fn(),
      load: (): TSessionLoadOutcome => ({
        status: 'valid',
        record: replayOnly,
        authorship: 'unverified',
      }),
      list: () => [
        {
          id: 'sess_replay',
          outcome: {
            status: 'valid' as const,
            record: replayOnly,
            authorship: 'unverified' as const,
          },
        },
      ],
      delete: vi.fn(),
      authorship,
    });
    const run = input(store, { resumeId: 'sess_replay' });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 1 });
    expect(run.text()).toBe(`${unacceptableSessionMessage('sess_replay')}\n`);
    expect(run.questions).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
    expect(authorship.adopt).not.toHaveBeenCalled();
  });
});

describe('-r with a name an unverified record took as its id', () => {
  it('refuses as ambiguous, naming both ids, and asks nothing', async () => {
    const w = sealedWorkspace();
    w.own(record('sess_mine', '2026-11-01T01:00:00.000Z', { name: 'deploy' }));
    // Planted beside it: a record whose id is that name, dated in the future so it sorts first.
    w.plant(record('deploy', '2999-12-31T23:59:59.000Z'));
    const before = w.bytesOf('deploy');
    const run = input(w.store, { resumeId: 'deploy' });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 1 });
    expect(run.text()).toBe(
      'deploy is the name of session sess_mine and also the id of a session not verified as ' +
        'yours, so it resumes neither; resume sess_mine by its id to continue it, or pick deploy ' +
        'in the resume picker when it is listed there.\n',
    );
    expect(run.questions).toEqual([]);
    expect(w.bytesOf('deploy').equals(before)).toBe(true);
  });

  it('refuses as ambiguous when the record under that id does not even read', async () => {
    const w = sealedWorkspace();
    w.own(record('sess_mine', '2026-11-01T01:00:00.000Z', { name: 'deploy' }));
    // Planted beside it: a file under the name's id that is not a record at all.
    writeFileSync(join(w.dir, 'deploy.json'), '{ "not": "a session record"');
    const run = input(w.store, { resumeId: 'deploy' });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 1 });
    expect(run.text()).toBe(
      'deploy is the name of session sess_mine and also the id of a session not verified as ' +
        'yours, so it resumes neither; resume sess_mine by its id to continue it, or pick deploy ' +
        'in the resume picker when it is listed there.\n',
    );
    expect(run.questions).toEqual([]);
  });

  it('still resumes a verified id first, and the unverified id when no verified name is the same', async () => {
    const w = sealedWorkspace();
    w.own(record('sess_mine', '2026-11-01T01:00:00.000Z'));
    w.plant(record('sess_other', '2999-12-31T23:59:59.000Z', { name: 'sess_mine' }));
    w.plant(record('sess_planted', '2026-11-01T02:00:00.000Z'));

    const byVerifiedId = input(w.store, { resumeId: 'sess_mine' });
    expect(await resolveStartupResume(byVerifiedId.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_mine',
    });
    const byUnverifiedId = input(w.store, { resumeId: 'sess_planted' }, [false]);
    expect(await resolveStartupResume(byUnverifiedId.value, notFound)).toEqual({
      kind: 'exit',
      code: 0,
    });
    expect(byUnverifiedId.questions).toEqual(['Resume it and mark it as yours? [y/N] ']);
  });
});

describe('-r <unverified id> --fork-session', () => {
  /** A record parked on a tool approval: a copy of it cannot be made until that is resolved. */
  function pendingRecord(id: string): IInteractiveSessionRecord {
    return {
      ...record(id, '2026-11-01T01:00:00.000Z'),
      messages: [
        {
          id: 'm-0',
          role: 'user',
          content: 'do it',
          timestamp: new Date('2026-11-01T00:01:00.000Z'),
          state: 'complete',
        },
        {
          id: 'm-1',
          role: 'assistant',
          content: '',
          timestamp: new Date('2026-11-01T00:02:00.000Z'),
          state: 'complete',
          toolCalls: [
            { id: 'call-1', type: 'function', function: { name: 'Act', arguments: '{}' } },
          ],
          metadata: { executionId: 'exec-1', providerCallId: 'pcall-1' },
        },
      ],
      pendingExecution: {
        executionId: 'exec-1',
        requests: [
          {
            executionId: 'exec-1',
            actionId: 'act-1',
            parentCallId: 'pcall-1',
            toolCallId: 'call-1',
            toolName: 'Act',
            requestId: 'req-1',
            kind: 'permission',
            data: {},
          },
        ],
      },
    };
  }

  it('leaves the source byte for byte as it was, and unverified, after a yes', async () => {
    const w = sealedWorkspace();
    w.plant(pendingRecord('sess_parked'));
    const before = w.bytesOf('sess_parked');
    const run = input(w.store, { resumeId: 'sess_parked' }, [true]);

    const started = await resolveStartupResume(run.value, notFound);
    expect(started).toMatchObject({ kind: 'start', resumeSessionId: 'sess_parked' });
    const acceptedDigest = started.kind === 'start' ? started.acceptedDigest : undefined;
    expect(
      () =>
        new InteractiveSession({
          host: testHost,
          cwd: CWD,
          sessionStore: w.store,
          resumeSessionId: 'sess_parked',
          ...(acceptedDigest !== undefined ? { acceptedDigest } : {}),
          forkSession: true,
          provider: createScriptedProvider([]).provider,
          bare: true,
          defaultTools: [],
        }),
    ).toThrow('pending execution');

    expect(w.bytesOf('sess_parked').equals(before)).toBe(true);
    expect(w.seenFresh('sess_parked')).toBe('unverified');
  });
});

describe('a served runtime’s launch over a store that seals', () => {
  it('reuses only an empty session verified as the owner’s', async () => {
    const w = sealedWorkspace();
    w.plant({ ...record('sess_empty_planted', '2026-11-01T05:00:00.000Z'), messages: [] });
    const run = input(w.store, { reuseEmptySession: true, interactive: false });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'start' });

    w.own({ ...record('sess_empty_mine', '2026-11-01T01:00:00.000Z'), messages: [] });
    expect(await resolveStartupResume(run.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_empty_mine',
    });
  });
});

describe('a store that never seals', () => {
  it('starts with no question: -c the newest, -r by name', async () => {
    const dir = sessionsDirectory();
    const store = createNodeHostSessionStore(dir, { sealing: 'plain' });
    store.save(record('sess_old', '2026-11-01T01:00:00.000Z', { name: 'old' }));
    store.save(record('sess_new', '2026-11-01T02:00:00.000Z'));

    const continued = input(store, { continueMode: true });
    const named = input(store, { resumeId: 'old' });
    expect(await resolveStartupResume(continued.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_new',
    });
    expect(await resolveStartupResume(named.value, notFound)).toEqual({
      kind: 'start',
      resumeSessionId: 'sess_old',
    });
    expect([...continued.written, ...named.written, ...continued.questions]).toEqual([]);
    expect(continueQuestion).toBeTypeOf('function');
  });

  it('takes an exact id before a name, and says the record does not read rather than that it is not yours', async () => {
    const dir = sessionsDirectory();
    const store = createNodeHostSessionStore(dir, { sealing: 'plain' });
    store.save(record('sess_mine', '2026-11-01T01:00:00.000Z', { name: 'deploy' }));
    // Beside it, a file under the name's id that is not a record at all.
    writeFileSync(join(dir, 'deploy.json'), '{ "not": "a session record"');
    const run = input(store, { resumeId: 'deploy' });

    expect(await resolveStartupResume(run.value, notFound)).toEqual({ kind: 'exit', code: 1 });
    expect(run.text()).toBe(
      'Cannot resume session deploy: the session store reported "corrupt" for its record.\n',
    );
    expect(run.questions).toEqual([]);
  });
});
