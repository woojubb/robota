/**
 * Deleting a project session over a virtual project host, so the order of the cascade, its stops and
 * its retries are checked on every platform. The same behaviour on the real Linux boundary is in
 * `workspace-session-deletion-linux.test.ts`.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectSessionStore } from '../node-session-stores.js';
import { ProjectSessionDeletionStoppedError } from '../workspace-session-deletion.js';
import { WorkspaceSessionLogSink } from '../workspace-session-io.js';
import {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  getWorkspaceProjectStateStorage,
} from '../../workspace-trust/index.js';

import type { IProjectSessionDeletion } from '../workspace-session-deletion.js';
import type { IProjectSessionStoreOptions } from '../workspace-session-store.js';
import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceProjectFiles,
  IWorkspaceProjectMutationBoundary,
  IWorkspaceProjectStateStorage,
  IWorkspaceTrustStore,
  TWorkspaceDirectoryRemoval,
  TWorkspaceProjectStateDirectories,
} from '../../workspace-trust/index.js';
import type { IProcessMarkerHandle } from '@robota-sdk/agent-core';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

const STATE: TWorkspaceProjectStateDirectories = {
  sessions: '.state/sessions',
  'session-logs': '.state/logs',
  memory: '.state/memory',
  checkpoints: '.state/checkpoints',
};
const trust: IWorkspaceTrustStore = {
  inspect: async () => ({ state: 'trusted', generation: 1 }),
  grant: async () => ({ state: 'trusted', generation: 1 }),
  revoke: async () => ({ state: 'revoked', generation: 2 }),
};

const DOOMED = 'doomed_session';
const CANARY = 'canary_session';
const PAYLOAD = '{"payload":true}';

/** A project tree held in memory: files by path, directories by path, every operation recorded. */
class VirtualProject {
  readonly files = new Map<string, Uint8Array>();
  /** Files that are really a link, FIFO or socket: listed so, refused by a file delete. */
  readonly specials = new Map<string, 'link' | 'other'>();
  readonly directories = new Set<string>();
  readonly operations: string[] = [];
  /** Answers `partial` for this many calls of a path before removing it. */
  readonly partialCalls = new Map<string, number>();
  /** Throws once for an operation on this path (`<op> <path>`), as a crash there would stop it. */
  readonly failOnce = new Set<string>();
  writerHeld = false;
  /** False: the host offers no directory removal. */
  canRemoveDirectories = true;
  private readonly encoder = new TextEncoder();

  has(path: string): boolean {
    return this.files.has(path) || this.directories.has(path);
  }

  under(path: string): string[] {
    return [...this.files.keys(), ...this.directories].filter(
      (entry) => entry === path || entry.startsWith(`${path}/`),
    );
  }

  private ensureParents(path: string): void {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      this.directories.add(segments.slice(0, index).join('/'));
    }
  }

  private parentExists(path: string): boolean {
    const parent = path.split('/').slice(0, -1).join('/');
    return parent === '' || this.directories.has(parent);
  }

  private trip(operation: string, path: string): void {
    const key = `${operation} ${path}`;
    if (this.failOnce.delete(key)) throw new Error(`injected failure: ${key}`);
    this.operations.push(key);
  }

  put(path: string, content: string): void {
    this.ensureParents(path);
    this.files.set(path, this.encoder.encode(content));
  }

  files_(): IWorkspaceProjectFiles {
    const noop = (): void => {};
    const listing = (segments: readonly string[]): IWorkspaceDirectoryEntry[] => {
      const prefix = segments.join('/');
      const names = new Map<string, IWorkspaceDirectoryEntry['kind']>();
      for (const [entries, kind] of [
        [[...this.files.keys()], 'file'],
        [[...this.directories], 'directory'],
      ] as const) {
        for (const entry of entries) {
          if (!entry.startsWith(`${prefix}/`)) continue;
          const rest = entry.slice(prefix.length + 1);
          if (!rest.includes('/')) names.set(rest, this.specials.get(entry) ?? kind);
        }
      }
      return [...names].map(([name, kind]) => ({ name, kind }));
    };
    const boundary: IWorkspaceProjectMutationBoundary = {
      acquireWriter: (relativeDirectory) => {
        this.trip('acquireWriter', relativeDirectory);
        if (this.writerHeld) return undefined;
        this.ensureParents(`${relativeDirectory}/active.guard`);
        this.files.set(`${relativeDirectory}/active.guard`, new Uint8Array());
        const handle: IProcessMarkerHandle = {
          holds: () => true,
          withGuard: <T>(operation: () => T) => ({ status: 'ran' as const, value: operation() }),
          release: () => {
            this.operations.push(`release ${relativeDirectory}`);
          },
        };
        return handle;
      },
      claimDirectory: () => true,
      write: (path, content) => {
        this.trip('write', path);
        this.ensureParents(path);
        this.files.set(path, typeof content === 'string' ? this.encoder.encode(content) : content);
      },
      replace: (path, content) => {
        this.trip('replace', path);
        this.ensureParents(path);
        this.files.set(path, typeof content === 'string' ? this.encoder.encode(content) : content);
      },
      append: (path, content, options) => {
        if (options?.create === false && (!this.parentExists(path) || !this.files.has(path))) {
          return false;
        }
        this.trip('append', path);
        this.ensureParents(path);
        const previous = this.files.get(path) ?? new Uint8Array();
        const added = this.encoder.encode(content);
        const next = new Uint8Array(previous.length + added.length);
        next.set(previous);
        next.set(added, previous.length);
        this.files.set(path, next);
        return true;
      },
      delete: (path) => {
        this.trip('delete', path);
        if (this.specials.has(path))
          throw new Error('a file delete refuses a link or special file');
        return this.files.delete(path);
      },
      sweepTemporaries: () => 0,
      linkCount: (path) => (this.files.has(path) ? 1 : undefined),
      stage: () => {
        throw new Error('not used');
      },
      commitStaged: noop,
      discardStaged: noop,
      removeDirectory: (path): TWorkspaceDirectoryRemoval => {
        this.trip('removeDirectory', path);
        if (this.files.delete(path)) {
          this.specials.delete(path);
          return { status: 'removed' };
        }
        if (!this.directories.has(path)) return { status: 'absent' };
        const remaining = this.partialCalls.get(path) ?? 0;
        if (remaining > 0) {
          this.partialCalls.set(path, remaining - 1);
          return { status: 'partial', reason: 'budget' };
        }
        for (const entry of this.under(path)) {
          this.files.delete(entry);
          this.directories.delete(entry);
        }
        return { status: 'removed' };
      },
    };
    if (!this.canRemoveDirectories) delete boundary.removeDirectory;
    return {
      readBytes: (_root, segments) => this.files.get(segments.join('/')),
      listDirectory: (_identity, _resolver, segments) => listing(segments),
      inspectKind: (_identity, _resolver, segments) => {
        const path = segments.join('/');
        if (this.files.has(path)) return 'file';
        return this.directories.has(path) ? 'directory' : undefined;
      },
      createMutationBoundary: () => boundary,
      createStableWriter: () => ({ assertNamedRoot: noop, writeUtf8WhileNamed: noop, close: noop }),
    };
  }
}

function logLines(id: string): string {
  const line = (fields: Record<string, unknown>): string =>
    JSON.stringify({ schemaVersion: 1, sessionId: id, ...fields });
  const message = (index: number, role: string, content: string) =>
    line({
      timestamp: `2026-05-05T00:00:0${index + 1}.000Z`,
      event: 'history_mutation',
      mutation: 'append_message',
      index,
      message: {
        id: `${role}${index}`,
        role,
        content,
        state: 'complete',
        timestamp: `2026-05-05T00:00:0${index + 1}.000Z`,
      },
    });
  return `${[
    line({
      timestamp: '2026-05-05T00:00:00.000Z',
      event: 'session_init',
      cwd: '/project',
      provider: 'scripted',
      model: 'scripted',
      systemPrompt: '',
      systemPromptLength: 0,
      toolSchemas: [],
    }),
    message(0, 'user', 'hello'),
    message(1, 'assistant', 'hi'),
  ].join('\n')}\n`;
}

function record(id: string) {
  return {
    id,
    name: `named ${id}`,
    cwd: '/project',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:09.000Z',
    messages: [],
  };
}

interface IFixture {
  readonly project: VirtualProject;
  readonly sessions: IWorkspaceProjectStateStorage;
  readonly logs: IWorkspaceProjectStateStorage;
  readonly checkpoints: IWorkspaceProjectStateStorage;
  readonly removedSubagentLogs: string[];
  store(options?: Partial<IProjectSessionStoreOptions>): IInteractiveSessionStore;
  deletion(extra?: Partial<IProjectSessionDeletion>): IProjectSessionDeletion;
  seed(id: string): void;
}

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'virtual-session-deletion-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function fixture(project = new VirtualProject()): Promise<IFixture> {
  const identity = { repositoryKey: 'virtual', displayPath: root, worktreeRoot: root };
  const access = await new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: trust,
    projectFiles: project.files_(),
    projectStateDirectories: STATE,
  }).inspect(root);
  if (access.status !== 'trusted') throw new Error('fixture trust missing');
  const sessions = getWorkspaceProjectStateStorage(access.authority, 'sessions');
  const logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
  const checkpoints = getWorkspaceProjectStateStorage(access.authority, 'checkpoints');
  const removedSubagentLogs: string[] = [];
  const deletion = (extra: Partial<IProjectSessionDeletion> = {}): IProjectSessionDeletion => ({
    checkpoints,
    removeSubagentLogs: (id) => {
      project.operations.push(`removeSubagentLogs ${id}`);
      removedSubagentLogs.push(id);
    },
    ...extra,
  });
  const store = (options: Partial<IProjectSessionStoreOptions> = {}): IInteractiveSessionStore =>
    createProjectSessionStore(sessions, logs, { sealing: 'plain', ...options });
  const seed = (id: string): void => {
    store().save(record(id));
    project.put(`.state/logs/${id}.jsonl`, logLines(id));
    project.put(`.state/logs/${id}.payloads/abc.json`, '{}');
    project.put(`.state/checkpoints/${id}/turn-0001/manifest.json`, '{}');
    project.put(`.state/checkpoints/${id}/turn-0001/files/000001.content`, 'x');
    project.put(`.state/checkpoints/${id}/turn-0002/manifest.json`, '{}');
    project.put(`.state/checkpoints/${id}/.writer/active.guard`, '');
  };
  return { project, sessions, logs, checkpoints, removedSubagentLogs, store, deletion, seed };
}

function listedIds(store: IInteractiveSessionStore): string[] {
  return store.list().map((entry) => entry.id);
}

describe('deleting a project session (virtual host)', () => {
  it('removes the log, payloads, checkpoints and subagent logs, and the record last; a sibling is untouched', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    f.seed(CANARY);
    const canaryBefore = f.project.under(`.state/checkpoints/${CANARY}`).sort();
    const store = f.store({ deletion: f.deletion() });
    f.project.operations.length = 0;

    store.delete(DOOMED);

    expect(f.project.under(`.state/logs/${DOOMED}.jsonl`)).toEqual([]);
    expect(f.project.under(`.state/logs/${DOOMED}.payloads`)).toEqual([]);
    expect(f.project.under(`.state/checkpoints/${DOOMED}`)).toEqual([]);
    expect(f.project.has(`.state/sessions/${DOOMED}.json`)).toBe(false);
    expect(f.removedSubagentLogs).toEqual([DOOMED]);
    expect(f.project.operations).toEqual([
      `removeDirectory .state/logs/${DOOMED}.jsonl`,
      `removeDirectory .state/logs/${DOOMED}.payloads`,
      `acquireWriter .state/checkpoints/${DOOMED}/.writer`,
      `removeDirectory .state/checkpoints/${DOOMED}/turn-0001`,
      `removeDirectory .state/checkpoints/${DOOMED}/turn-0002`,
      `release .state/checkpoints/${DOOMED}/.writer`,
      `removeDirectory .state/checkpoints/${DOOMED}`,
      `removeSubagentLogs ${DOOMED}`,
      `delete .state/sessions/${DOOMED}.json`,
    ]);
    expect(listedIds(store)).toEqual([CANARY]);
    expect(store.load(DOOMED)).toEqual({ status: 'missing' });
    expect(store.load(CANARY).status).toBe('valid');
    expect(f.project.has(`.state/logs/${CANARY}.jsonl`)).toBe(true);
    expect(f.project.has(`.state/logs/${CANARY}.payloads/abc.json`)).toBe(true);
    expect(f.project.under(`.state/checkpoints/${CANARY}`).sort()).toEqual(canaryBefore);
  });

  it('deletes a session that has no log, payloads or checkpoints, creating none', async () => {
    const f = await fixture();
    f.store().save(record(DOOMED));
    const store = f.store({ deletion: f.deletion() });
    store.delete(DOOMED);
    expect(store.load(DOOMED)).toEqual({ status: 'missing' });
    expect(f.project.under(`.state/checkpoints/${DOOMED}`)).toEqual([]);
    expect(f.project.under(`.state/logs/${DOOMED}.payloads`)).toEqual([]);
  });

  it('finishes a session whose record is gone but whose log still lists it', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    f.project.files.delete(`.state/sessions/${DOOMED}.json`);
    const store = f.store({ deletion: f.deletion() });
    expect(listedIds(store)).toEqual([DOOMED]);
    expect(store.load(DOOMED).status).toBe('valid');

    store.delete(DOOMED);

    expect(listedIds(store)).toEqual([]);
    expect(store.load(DOOMED)).toEqual({ status: 'missing' });
    expect(f.project.under(`.state/checkpoints/${DOOMED}`)).toEqual([]);
  });

  it.each([
    ['the log', `removeDirectory .state/logs/${DOOMED}.jsonl`],
    ['the payloads', `removeDirectory .state/logs/${DOOMED}.payloads`],
    ['the checkpoints', `removeDirectory .state/checkpoints/${DOOMED}`],
  ])(
    'keeps the record, and the session as it was saved, when it stops at %s; a retry finishes',
    async (_step, failing) => {
      const f = await fixture();
      f.seed(DOOMED);
      const store = f.store({ deletion: f.deletion() });
      f.project.failOnce.add(failing);

      expect(() => store.delete(DOOMED)).toThrow(/injected failure/);

      // The record still answers: the session is listed and loads as saved, not rebuilt from a log.
      expect(listedIds(store)).toEqual([DOOMED]);
      const outcome = store.load(DOOMED);
      expect(outcome.status === 'valid' && outcome.record.name).toBe(`named ${DOOMED}`);
      expect(f.removedSubagentLogs).toEqual([]);

      store.delete(DOOMED);
      expect(listedIds(store)).toEqual([]);
      expect(store.load(DOOMED)).toEqual({ status: 'missing' });
      expect(f.project.under(`.state/logs/${DOOMED}.jsonl`)).toEqual([]);
      expect(f.project.under(`.state/checkpoints/${DOOMED}`)).toEqual([]);
    },
  );

  it.each([
    [`.state/logs/${DOOMED}.jsonl`, 'link'],
    [`.state/logs/${DOOMED}.jsonl`, 'other'],
    [`.state/logs/${DOOMED}.payloads`, 'link'],
    [`.state/logs/${DOOMED}.payloads`, 'other'],
    [`.state/checkpoints/${DOOMED}`, 'link'],
    [`.state/checkpoints/${DOOMED}`, 'other'],
  ] as const)('removes a %s planted as a %s by name, the record last', async (name, kind) => {
    const f = await fixture();
    f.seed(DOOMED);
    for (const entry of f.project.under(name)) {
      f.project.files.delete(entry);
      f.project.directories.delete(entry);
    }
    f.project.put(name, '');
    f.project.specials.set(name, kind);
    const store = f.store({ deletion: f.deletion() });
    f.project.operations.length = 0;

    store.delete(DOOMED);

    expect(f.project.has(name)).toBe(false);
    expect(f.project.operations).toContain(`removeDirectory ${name}`);
    expect(f.project.operations.at(-1)).toBe(`delete .state/sessions/${DOOMED}.json`);
    expect(listedIds(store)).toEqual([]);
    expect(store.load(DOOMED)).toEqual({ status: 'missing' });
  });

  it('keeps the record when the subagent logs cannot be removed', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    let fail = true;
    const store = f.store({
      deletion: f.deletion({
        removeSubagentLogs: () => {
          if (fail) throw new Error('subagent logs refused');
        },
      }),
    });
    expect(() => store.delete(DOOMED)).toThrow(/subagent logs refused/);
    expect(store.load(DOOMED).status).toBe('valid');
    fail = false;
    store.delete(DOOMED);
    expect(store.load(DOOMED)).toEqual({ status: 'missing' });
  });

  it('refuses while a checkpoint writer holds the lease, touching no checkpoint and keeping the record', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    const checkpointsBefore = f.project.under(`.state/checkpoints/${DOOMED}`).sort();
    f.project.writerHeld = true;
    const store = f.store({ deletion: f.deletion() });

    let thrown: unknown;
    try {
      store.delete(DOOMED);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProjectSessionDeletionStoppedError);
    expect((thrown as ProjectSessionDeletionStoppedError).reason).toBe('checkpoint-writer');
    expect(f.project.under(`.state/checkpoints/${DOOMED}`).sort()).toEqual(checkpointsBefore);
    expect(f.removedSubagentLogs).toEqual([]);
    expect(f.project.has(`.state/sessions/${DOOMED}.json`)).toBe(true);
    expect(store.load(DOOMED).status).toBe('valid');

    f.project.writerHeld = false;
    store.delete(DOOMED);
    expect(f.project.under(`.state/checkpoints/${DOOMED}`)).toEqual([]);
    expect(store.load(DOOMED)).toEqual({ status: 'missing' });
  });

  it('retries a partial removal, and past the bound stops with the record kept until a retry finishes', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    const store = f.store({ deletion: f.deletion() });
    f.project.partialCalls.set(`.state/logs/${DOOMED}.payloads`, 3);
    f.project.partialCalls.set(`.state/checkpoints/${DOOMED}/turn-0001`, 100);

    let thrown: unknown;
    try {
      store.delete(DOOMED);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ProjectSessionDeletionStoppedError).reason).toBe('incomplete-removal');
    expect(f.project.under(`.state/logs/${DOOMED}.payloads`)).toEqual([]);
    expect(f.project.has(`.state/sessions/${DOOMED}.json`)).toBe(true);
    // The lease was released on the way out, so the retry can take it.
    expect(f.project.operations).toContain(`release .state/checkpoints/${DOOMED}/.writer`);

    f.project.partialCalls.set(`.state/checkpoints/${DOOMED}/turn-0001`, 2);
    store.delete(DOOMED);
    expect(f.project.under(`.state/checkpoints/${DOOMED}`)).toEqual([]);
    expect(store.load(DOOMED)).toEqual({ status: 'missing' });
  });

  it('is refused before anything is touched by a host that cannot remove directories', async () => {
    const project = new VirtualProject();
    project.canRemoveDirectories = false;
    const f = await fixture(project);
    f.seed(DOOMED);
    const before = [...project.files.keys()].sort();
    const store = f.store({ deletion: f.deletion() });
    project.operations.length = 0;

    expect(() => store.delete(DOOMED)).toThrow(WorkspaceAuthorityRequiredError);
    expect(project.operations).toEqual([]);
    expect([...project.files.keys()].sort()).toEqual(before);
  });

  it('removes only the record when built without deletion, as before', async () => {
    const f = await fixture();
    f.seed(DOOMED);
    const store = f.store();
    f.project.operations.length = 0;
    store.delete(DOOMED);
    expect(f.project.operations).toEqual([`delete .state/sessions/${DOOMED}.json`]);
    expect(f.project.has(`.state/logs/${DOOMED}.jsonl`)).toBe(true);
    expect(f.project.under(`.state/checkpoints/${DOOMED}`).length).toBeGreaterThan(0);
  });
});

describe('a late session log write after a delete', () => {
  it('creates nothing, through the sink the store told and through one it did not', async () => {
    const f = await fixture();
    f.store().save(record(DOOMED));
    const told = new WorkspaceSessionLogSink(f.logs, { sealing: 'plain' });
    const untold = new WorkspaceSessionLogSink(f.logs, { sealing: 'plain' });
    told.append(DOOMED, '{"a":1}\n');
    untold.append(DOOMED, '{"b":2}\n');
    const store = f.store({ deletion: f.deletion({ logSinks: [told] }) });

    store.delete(DOOMED);

    for (const sink of [told, untold]) {
      expect(() => sink.append(DOOMED, '{"late":true}\n')).not.toThrow();
      sink.writeJson(DOOMED, createHash('sha256').update(PAYLOAD).digest('hex'), PAYLOAD);
    }
    expect(f.project.under(`.state/logs/${DOOMED}.jsonl`)).toEqual([]);
    expect(f.project.under(`.state/logs/${DOOMED}.payloads`)).toEqual([]);
    expect(listedIds(store)).toEqual([]);

    // Neither sink disabled itself: a sibling session still logs.
    told.append(CANARY, '{"c":3}\n');
    untold.append(CANARY, '{"d":4}\n');
    expect(f.project.has(`.state/logs/${CANARY}.jsonl`)).toBe(true);
  });

  it('logs anew once the id is claimed again: a session with a deleted id is a new one', async () => {
    const f = await fixture();
    f.store().save(record(DOOMED));
    const sink = new WorkspaceSessionLogSink(f.logs, { sealing: 'plain' });
    sink.append(DOOMED, '{"a":1}\n');
    const store = f.store({ deletion: f.deletion({ logSinks: [sink] }) });
    store.delete(DOOMED);
    sink.append(DOOMED, '{"late":true}\n');
    expect(f.project.has(`.state/logs/${DOOMED}.jsonl`)).toBe(false);

    const claim = store.claim(DOOMED, { fresh: true });
    try {
      sink.append(DOOMED, '{"new":true}\n');
      expect(new TextDecoder().decode(f.project.files.get(`.state/logs/${DOOMED}.jsonl`))).toBe(
        '{"new":true}\n',
      );
    } finally {
      claim.release();
    }
  });
});
