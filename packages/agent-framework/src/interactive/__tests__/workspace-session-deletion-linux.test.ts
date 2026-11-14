/**
 * Deleting a project session on the real project boundary, which mutates project state only on
 * Linux. The order of the cascade, its stops and retries are checked on every platform over a virtual
 * host in `workspace-session-deletion.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileSessionLogger } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeSubagentLogs } from '../../assembly/subagent-log-removal.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import { createProjectSessionStore } from '../node-session-stores.js';
import { ProjectSessionDeletionStoppedError } from '../workspace-session-deletion.js';
import { WorkspaceSessionLogSink } from '../workspace-session-io.js';

import type { IWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

const DOOMED = 'doomed_session';
const CANARY = 'canary_session';
const PAYLOAD = JSON.stringify({ big: 'x'.repeat(64) });
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex');

let scratch: string;
let project: string;
let logRoot: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'session-deletion-linux-')));
  project = join(scratch, 'project');
  logRoot = join(scratch, 'user-logs');
  mkdirSync(project);
  mkdirSync(logRoot);
  mkdirSync(join(scratch, 'outside'));
  writeFileSync(join(scratch, 'outside', 'canary.txt'), 'CANARY');
});

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  rmSync(scratch, { recursive: true, force: true });
});

/** Puts a link to a canary directory outside the project, a FIFO or a socket at `path`. */
async function plant(path: string, kind: 'link' | 'fifo' | 'socket'): Promise<void> {
  rmSync(path, { recursive: true, force: true });
  if (kind === 'link') {
    symlinkSync(join(scratch, 'outside'), path);
  } else if (kind === 'fifo') {
    execFileSync('mkfifo', [path]);
  } else {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));
  }
}

interface IFixture {
  readonly logs: IWorkspaceProjectStateStorage;
  readonly checkpoints: IWorkspaceProjectStateStorage;
  readonly sink: WorkspaceSessionLogSink;
  readonly store: IInteractiveSessionStore;
  seed(id: string): void;
}

async function fixture(): Promise<IFixture> {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  const sessions = getWorkspaceProjectStateStorage(access.authority, 'sessions');
  const logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
  const checkpoints = getWorkspaceProjectStateStorage(access.authority, 'checkpoints');
  const sink = new WorkspaceSessionLogSink(logs, { sealing: 'plain' });
  const store = createProjectSessionStore(sessions, logs, {
    sealing: 'plain',
    deletion: {
      checkpoints,
      removeSubagentLogs: (id) => {
        removeSubagentLogs(logRoot, id);
      },
      logSinks: [sink],
    },
  });
  const seed = (id: string): void => {
    store.save({
      id,
      name: `named ${id}`,
      cwd: project,
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:09.000Z',
      messages: [],
    });
    sink.append(id, `${JSON.stringify({ schemaVersion: 1, sessionId: id, event: 'note' })}\n`);
    sink.writeJson(id, PAYLOAD_SHA, PAYLOAD);
    checkpoints.writeText(`${id}/turn-0001/manifest.json`, '{}', 'seed a checkpoint');
    checkpoints.writeText(`${id}/turn-0001/files/000001.content`, 'pre', 'seed a checkpoint');
    checkpoints.writeText(`${id}/turn-0002/manifest.json`, '{}', 'seed a checkpoint');
    checkpoints.acquireWriter?.(`${id}/.writer`, 'seed the writer lease')?.release();
    mkdirSync(join(logRoot, id, 'subagents', 'task_1.payloads'), { recursive: true });
    writeFileSync(join(logRoot, id, 'subagents', 'task_1.jsonl'), '{}\n');
    writeFileSync(join(logRoot, id, 'subagents', 'task_1.payloads', 'a.json'), '{}');
  };
  return { logs, checkpoints, sink, store, seed };
}

const state = (...segments: string[]): string => join(project, '.agent', ...segments);

function leftovers(id: string): string[] {
  return [
    state('sessions', `${id}.json`),
    state('logs', `${id}.jsonl`),
    state('logs', `${id}.payloads`),
    state('checkpoints', id),
    join(logRoot, id),
  ].filter((path) => existsSync(path));
}

describe.runIf(process.platform === 'linux')('deleting a project session (Linux boundary)', () => {
  it('leaves nothing of the session but the claim lock file, and a sibling session is intact', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    f.seed(CANARY);
    expect(existsSync(state('checkpoints', DOOMED, '.writer', 'active.guard'))).toBe(true);
    expect(readdirSync(state('logs', `${DOOMED}.payloads`))).toHaveLength(1);

    f.store.delete(DOOMED);

    expect(leftovers(DOOMED)).toEqual([]);
    // The claim markers' lock identity stays by design.
    expect(existsSync(state('sessions', 'claims', `${DOOMED}.guard`))).toBe(true);
    expect(f.store.list().map((entry) => entry.id)).toEqual([CANARY]);
    expect(f.store.load(DOOMED)).toEqual({ status: 'missing' });
    expect(leftovers(CANARY)).toHaveLength(5);
    expect(existsSync(state('checkpoints', CANARY, 'turn-0001', 'files', '000001.content'))).toBe(
      true,
    );
    expect(f.store.load(CANARY).status).toBe('valid');
  });

  it('finishes a session whose record was removed but whose log still lists it', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    rmSync(state('sessions', `${DOOMED}.json`));
    expect(f.store.list().map((entry) => entry.id)).toEqual([DOOMED]);

    f.store.delete(DOOMED);

    expect(f.store.list()).toEqual([]);
    expect(f.store.load(DOOMED)).toEqual({ status: 'missing' });
    expect(leftovers(DOOMED)).toEqual([]);
  });

  it('refuses while a checkpoint writer holds the lease, touching no checkpoint and keeping the record', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    const writer = f.checkpoints.acquireWriter?.(`${DOOMED}/.writer`, 'hold the writer lease');
    expect(writer).toBeDefined();
    try {
      expect(() => f.store.delete(DOOMED)).toThrow(ProjectSessionDeletionStoppedError);
      expect(existsSync(state('checkpoints', DOOMED, 'turn-0001', 'manifest.json'))).toBe(true);
      expect(existsSync(state('checkpoints', DOOMED, 'turn-0002', 'manifest.json'))).toBe(true);
      expect(existsSync(join(logRoot, DOOMED, 'subagents', 'task_1.jsonl'))).toBe(true);
      expect(f.store.load(DOOMED).status).toBe('valid');
    } finally {
      writer?.release();
    }
    f.store.delete(DOOMED);
    expect(leftovers(DOOMED)).toEqual([]);
  });

  it('a log flush after the delete creates nothing and does not throw into the session', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    const logger = new FileSessionLogger(f.sink);
    logger.log(DOOMED, 'text_delta', { delta: 'buffered before the delete' });
    // Another sink over the same logs that has written for the session: as another process would.
    const other = new WorkspaceSessionLogSink(f.logs, { sealing: 'plain' });
    other.append(DOOMED, '{"other":1}\n');

    f.store.delete(DOOMED);

    expect(() => logger.flush()).not.toThrow();
    expect(() => logger.log(DOOMED, 'session_shutdown', { reason: 'late' })).not.toThrow();
    other.append(DOOMED, '{"late":true}\n');
    other.writeJson(DOOMED, PAYLOAD_SHA, PAYLOAD);
    expect(existsSync(state('logs', `${DOOMED}.jsonl`))).toBe(false);
    expect(existsSync(state('logs', `${DOOMED}.payloads`))).toBe(false);
    expect(readdirSync(state('logs')).filter((name) => name.startsWith(DOOMED))).toEqual([]);
    expect(f.store.list().map((entry) => entry.id)).toEqual([]);
  });

  it.each(
    (['logs/S.jsonl', 'logs/S.payloads', 'checkpoints/S', 'sessions/S.json'] as const).flatMap(
      (name) => (['link', 'fifo', 'socket'] as const).map((kind) => [name, kind] as const),
    ),
  )('removes %s planted as a %s by name, following nothing', async (name, kind) => {
    const f = await fixture();
    f.seed(DOOMED);
    const planted = state(...name.replace('S', DOOMED).split('/'));
    await plant(planted, kind);
    expect(lstatSync(planted).isDirectory()).toBe(false);

    f.store.delete(DOOMED);

    expect(lstatSync(planted, { throwIfNoEntry: false })).toBeUndefined();
    expect(leftovers(DOOMED)).toEqual([]);
    expect(f.store.list()).toEqual([]);
    expect(f.store.load(DOOMED)).toEqual({ status: 'missing' });
    expect(readFileSync(join(scratch, 'outside', 'canary.txt'), 'utf8')).toBe('CANARY');
  });

  it('still refuses when an ancestor of the session data is a link', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    rmSync(state('checkpoints'), { recursive: true, force: true });
    mkdirSync(join(scratch, 'outside', 'checkpoints', DOOMED), { recursive: true });
    symlinkSync(join(scratch, 'outside', 'checkpoints'), state('checkpoints'));

    expect(() => f.store.delete(DOOMED)).toThrow();

    expect(existsSync(join(scratch, 'outside', 'checkpoints', DOOMED))).toBe(true);
    expect(f.store.load(DOOMED).status).toBe('valid');
  });

  it('a non-creating append creates neither the file nor a missing directory', async () => {
    const f = await fixture();
    expect(f.logs.appendText('nested/late.jsonl', 'x\n', 'late append', { create: false })).toBe(
      false,
    );
    expect(existsSync(state('logs', 'nested'))).toBe(false);
    expect(f.logs.appendText('late.jsonl', 'x\n', 'late append', { create: false })).toBe(false);
    expect(existsSync(state('logs', 'late.jsonl'))).toBe(false);
    expect(f.logs.appendText('late.jsonl', 'a\n', 'first append')).toBe(true);
    expect(f.logs.appendText('late.jsonl', 'b\n', 'late append', { create: false })).toBe(true);
    expect(f.logs.readText('late.jsonl', 'read it back')).toBe('a\nb\n');
  });
});
