/**
 * Sealing a trusted project's plain session records and replay logs in place (#3679, secure
 * conversation), through the project's runtime-minted state storage: records sealed as their raw
 * bytes, logs one sealed record per line after their sidecars, a file that would be past the project
 * read limit sealed left plain, a file that changed or does not open left alone. Project writes are
 * Linux-only, so these run there.
 */
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { FileSessionLogger } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import { MAX_PROJECT_READ_BYTES } from '../../workspace-trust/project-reader-path.js';
import { createProjectSessionStore } from '../session-persistence.js';
import { WorkspaceSessionLogSink } from '../workspace-session-io.js';
import {
  migrateWorkspaceProjectSessionLogs,
  migrateWorkspaceProjectSessionRecords,
} from '../workspace-session-migration.js';

import type { IWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-77b3-said-in-a-trusted-project';

let base: string;
let project: string;
let sessions: IWorkspaceProjectStateStorage;
let logs: IWorkspaceProjectStateStorage;

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'workspace-session-migration-')));
  project = join(base, 'project');
  mkdirSync(project);
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected a trusted fixture');
  sessions = getWorkspaceProjectStateStorage(access.authority, 'sessions');
  logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const stateDirectory = (): string => join(project, '.agent');
const sessionsDirectory = (): string => join(stateDirectory(), 'sessions');
const logsDirectory = (): string => join(stateDirectory(), 'logs');

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: project,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: `${CANARY} ${id}`,
        timestamp: new Date('2026-11-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

/** A replay-only session — a log and its sidecars, no snapshot — as builds before sealing wrote it. */
function seedReplayLog(id: string): void {
  const logger = new FileSessionLogger(new WorkspaceSessionLogSink(logs), {
    externalPayloadThresholdBytes: 64,
  });
  for (const [index, role] of (['user', 'assistant'] as const).entries()) {
    logger.log(id, 'history_mutation', {
      mutation: 'append_message',
      index,
      message: {
        id: `m-${index}`,
        role,
        content: `${CANARY} ${role} `.repeat(8),
        state: 'complete',
        timestamp: `2026-11-01T00:0${index}:00.000Z`,
      },
    });
  }
}

/** A project store as builds before sealing left it. */
function seedPlainProject(): void {
  const store = createProjectSessionStore(sessions, logs);
  store.save(record('saved_one'));
  store.save(record('saved_two'));
  writeFileSync(join(sessionsDirectory(), 'corrupt_one.json'), `{"record":"${CANARY}`);
  seedReplayLog('replayed_one');
}

const IDS = ['corrupt_one', 'replayed_one', 'saved_one', 'saved_two'];

function outcomes(sealer: IArtifactSealer): Record<string, unknown> {
  const store = createProjectSessionStore(sessions, logs, { sealing: { sealer } });
  return Object.fromEntries(IDS.map((id) => [id, store.load(id)]));
}

function everyFile(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

const withCanary = (): string[] =>
  everyFile(stateDirectory()).filter((path) => readFileSync(path).includes(Buffer.from(CANARY)));

function migrate(sealer: IArtifactSealer, apply: boolean, beforeCommit?: () => void) {
  const options = { sealer, apply, ...(beforeCommit === undefined ? {} : { beforeCommit }) };
  return {
    records: migrateWorkspaceProjectSessionRecords(sessions, options),
    logs: migrateWorkspaceProjectSessionLogs(logs, options),
  };
}

describe.runIf(process.platform === 'linux')('migrating a trusted project session store', () => {
  it('seals records and replay logs in place, and the store reports every session as it did', () => {
    seedPlainProject();
    const sealer = createTestArtifactSealer();
    const before = outcomes(sealer);
    expect((before.replayed_one as { status: string }).status).toBe('valid');
    const sidecars = readdirSync(join(logsDirectory(), 'replayed_one.payloads')).sort();

    const result = migrate(sealer, true);

    expect(result.records).toMatchObject({ sealed: 3, alreadySealed: 0, overCap: [], changed: [] });
    expect(result.logs).toMatchObject({
      logs: 1,
      lines: 2,
      payloads: sidecars.length,
      changed: [],
    });
    expect(withCanary()).toEqual([]);
    expect(readdirSync(join(logsDirectory(), 'replayed_one.payloads')).sort()).toEqual(sidecars);
    expect(outcomes(sealer)).toEqual(before);
  });

  it('is idempotent, and planning writes nothing', () => {
    seedPlainProject();
    const sealer = createTestArtifactSealer();
    const plain = everyFile(stateDirectory()).map((path) => [path, readFileSync(path)] as const);

    const plan = migrate(sealer, false);
    expect(plan.records.sealed).toBe(3);
    expect(plan.logs.logs).toBe(1);
    expect(everyFile(stateDirectory()).map((path) => [path, readFileSync(path)] as const)).toEqual(
      plain,
    );

    migrate(sealer, true);
    const sealed = everyFile(stateDirectory()).map((path) => [path, readFileSync(path)] as const);
    const rerun = migrate(sealer, true);
    expect(rerun.records).toMatchObject({ sealed: 0, alreadySealed: 3 });
    expect(rerun.logs).toMatchObject({ logs: 0, payloads: 0 });
    expect(everyFile(stateDirectory()).map((path) => [path, readFileSync(path)] as const)).toEqual(
      sealed,
    );
  });

  it('stops at a commit point with that file as it was, and a rerun ends where an unbroken run does', () => {
    seedPlainProject();
    const sealer = createTestArtifactSealer();
    const before = outcomes(sealer);
    let commits = 0;

    expect(() =>
      migrate(sealer, true, () => {
        commits += 1;
        if (commits === 2) throw new Error('crash at the second commit point');
      }),
    ).toThrow('crash at the second commit point');
    expect(withCanary().length).toBeGreaterThan(0);
    expect(outcomes(sealer)).toEqual(before);

    migrate(sealer, true);
    expect(withCanary()).toEqual([]);
    expect(outcomes(sealer)).toEqual(before);
  });

  it('leaves plain, and reports, a record and a log that would be past the read limit sealed', () => {
    const sealer = createTestArtifactSealer();
    const filler = (size: number): string => `{"padding":"${'x'.repeat(size - 15)}"}\n`;
    mkdirSync(sessionsDirectory(), { recursive: true });
    mkdirSync(logsDirectory(), { recursive: true });
    const big = filler(MAX_PROJECT_READ_BYTES - 8);
    writeFileSync(join(sessionsDirectory(), 'big_one.json'), big);
    writeFileSync(join(logsDirectory(), 'big_log.jsonl'), big);

    const result = migrate(sealer, true);

    expect(result.records.overCap).toEqual(['.agent/sessions/big_one.json']);
    expect(result.logs.overCap).toEqual(['.agent/logs/big_log.jsonl']);
    expect(readFileSync(join(sessionsDirectory(), 'big_one.json'), 'utf8')).toBe(big);
    expect(readFileSync(join(logsDirectory(), 'big_log.jsonl'), 'utf8')).toBe(big);
  });

  it('leaves a record that changed after it was read, and one sealed with other keys', () => {
    const sealer = createTestArtifactSealer();
    createProjectSessionStore(sessions, logs).save(record('running_one'));
    createProjectSessionStore(sessions, logs, {
      sealing: { sealer: createTestArtifactSealer() },
    }).save(record('theirs'));
    const theirs = readFileSync(join(sessionsDirectory(), 'theirs.json'));
    const saved = JSON.stringify({ schemaVersion: 1, record: record('running_one') });

    const result = migrate(sealer, true, () =>
      writeFileSync(join(sessionsDirectory(), 'running_one.json'), saved),
    );

    expect(result.records.changed).toEqual(['.agent/sessions/running_one.json']);
    expect(result.records.unopenable).toEqual(['.agent/sessions/theirs.json']);
    expect(readFileSync(join(sessionsDirectory(), 'running_one.json'), 'utf8')).toBe(saved);
    expect(readFileSync(join(sessionsDirectory(), 'theirs.json'))).toEqual(theirs);
  });

  it('removes the stale temp files crashed replaces left, and keeps fresh ones', () => {
    const sealer = createTestArtifactSealer();
    createProjectSessionStore(sessions, logs).save(record('saved_one'));
    // Of a record since deleted: no replace of its own name will ever sweep it.
    const stale = join(sessionsDirectory(), '.deleted_one.json.0123456789abcdef.tmp');
    const fresh = join(sessionsDirectory(), '.other.json.fedcba9876543210.tmp');
    writeFileSync(stale, `${CANARY} in a crashed replace`);
    writeFileSync(fresh, `${CANARY} in a replace still running`);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(stale, tenMinutesAgo, tenMinutesAgo);

    const result = migrateWorkspaceProjectSessionRecords(sessions, {
      sealer,
      apply: true,
      sweepTemporaries: true,
    });

    expect(result.staleTemporaries).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('refuses a record, a log and a sidecar with another name, and leaves each plain', () => {
    seedPlainProject();
    const sidecar = readdirSync(join(logsDirectory(), 'replayed_one.payloads'))[0] as string;
    const linked = [
      join(sessionsDirectory(), 'saved_one.json'),
      join(logsDirectory(), 'replayed_one.jsonl'),
      join(logsDirectory(), 'replayed_one.payloads', sidecar),
    ];
    for (const [index, path] of linked.entries()) linkSync(path, join(base, `backup-${index}`));

    const result = migrate(createTestArtifactSealer(), true);

    expect(result.records.refused).toEqual(['.agent/sessions/saved_one.json']);
    expect([...result.logs.refused].sort()).toEqual(
      ['.agent/logs/replayed_one.jsonl', `.agent/logs/replayed_one.payloads/${sidecar}`].sort(),
    );
    for (const [index, path] of linked.entries()) {
      expect(readFileSync(path)).toEqual(readFileSync(join(base, `backup-${index}`)));
    }
    expect(result.records.sealed).toBe(2);
  });

  it('writes and flushes every sealed record beside its file before it puts any in place', () => {
    seedPlainProject();
    const staged: number[] = [];

    migrateWorkspaceProjectSessionRecords(sessions, {
      sealer: createTestArtifactSealer(),
      apply: true,
      beforeCommit: () => {
        staged.push(
          readdirSync(sessionsDirectory()).filter((name) => name.endsWith('.tmp')).length,
        );
      },
    });

    expect(staged).toEqual([3, 2, 1]);
    expect(readdirSync(sessionsDirectory()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('judges a temp file against when the migration started, in a directory nothing changed since', () => {
    const sealer = createTestArtifactSealer();
    createProjectSessionStore(sessions, logs, { sealing: { sealer } }).save(record('sealed_one'));
    const stale = join(sessionsDirectory(), '.deleted_one.json.0123456789abcdef.tmp');
    writeFileSync(stale, `${CANARY} in a crashed replace`);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(stale, tenMinutesAgo, tenMinutesAgo);
    utimesSync(sessionsDirectory(), tenMinutesAgo, tenMinutesAgo);

    const result = migrateWorkspaceProjectSessionRecords(sessions, {
      sealer,
      apply: true,
      sweepTemporaries: true,
      migrationStartedAt: Date.now(),
    });

    expect(result.staleTemporaries).toBe(1);
    expect(existsSync(stale)).toBe(false);
  });

  it('seals the subagent logs older builds kept beside the replay logs', () => {
    const sealer = createTestArtifactSealer();
    const directory = join(logsDirectory(), 'parent_one', 'subagents');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'task_one.jsonl'), `{"note":"${CANARY}"}\n\n{"note":"two"}\n`);

    const result = migrateWorkspaceProjectSessionLogs(logs, { sealer, apply: true });

    expect(result).toMatchObject({ logs: 1, lines: 2 });
    expect(withCanary()).toEqual([]);
  });
});
