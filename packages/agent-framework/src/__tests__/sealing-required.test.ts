/**
 * Every conversation store the framework builds states how it seals (#3679, secure conversation):
 * there is no plain default for a host to fall into, because a store left plain beside sealed ones
 * writes plaintext next to them. Readers state it too, since a plain reader cannot open a sealed line.
 * The tool-result spill is also given the host directory it lives in; it has no shared-temporary
 * fallback.
 *
 * Each `@ts-expect-error` below is checked by `pnpm typecheck`: the line fails to compile when the
 * decision is left out, and a line that starts compiling makes the directive itself an error. The
 * `expect` beside it holds a caller that ignores the types to the same rule at run time.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSubagentLogger, readSubagentTranscriptPage } from '../assembly/subagent-logger.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import { validateWorkspaceSessionReplayLog } from '../interactive/workspace-session-replay-validation.js';
import {
  WorkspaceProjectSessionStore,
  WorkspaceSessionLogSink,
  WorkspaceSessionLogSource,
  createNodeHostSessionStore,
  createNodeToolResultSpillStore,
  createProjectSessionStore,
  createUserPromptHistoryFile,
  createUserSessionStore,
} from '../interactive/session-persistence.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import {
  createWorkspaceProjectMutation,
  getWorkspaceProjectStateStorage,
} from '../workspace-trust/index.js';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'framework-sealing-required-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function projectAccess() {
  const access = await createTrustedProjectAccessFixture(root);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return access;
}

describe('the session record stores', () => {
  it('state their sealing: the user, host and project stores', async () => {
    const access = await projectAccess();
    const sessions = getWorkspaceProjectStateStorage(access.authority, 'sessions');
    const logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');
    const directory = join(root, 'sessions');

    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => createUserSessionStore(directory)).toThrow(TypeError);
    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => createNodeHostSessionStore(directory)).toThrow(TypeError);
    // @ts-expect-error an owned root alone states nothing about sealing
    expect(() => createNodeHostSessionStore(directory, { ownedRoot: root })).toThrow(TypeError);
    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => createProjectSessionStore(sessions, logs)).toThrow(TypeError);
    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => new WorkspaceProjectSessionStore(sessions, logs)).toThrow(TypeError);

    expect(() => createUserSessionStore(directory, { sealing: 'plain' })).not.toThrow();
    expect(() =>
      createNodeHostSessionStore(directory, { sealing: 'plain', ownedRoot: root }),
    ).not.toThrow();
    expect(() => createProjectSessionStore(sessions, logs, { sealing: 'plain' })).not.toThrow();
  });
});

describe('the append stores', () => {
  it('state their sealing: the prompt history, the project log sink and source, the subagent log', async () => {
    const access = await projectAccess();
    const logs = getWorkspaceProjectStateStorage(access.authority, 'session-logs');

    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => createUserPromptHistoryFile(join(root, 'history'))).toThrow(TypeError);
    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => new WorkspaceSessionLogSink(logs)).toThrow(TypeError);
    // @ts-expect-error a reader states its sealing too
    expect(() => new WorkspaceSessionLogSource(logs, 'session_a')).toThrow(TypeError);
    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => createSubagentLogger('parent', 'agent', join(root, 'logs'))).toThrow(TypeError);

    expect(() => createUserPromptHistoryFile(join(root, 'h'), { sealing: 'plain' })).not.toThrow();
    expect(() => new WorkspaceSessionLogSink(logs, { sealing: 'plain' })).not.toThrow();
    expect(() => new WorkspaceSessionLogSource(logs, 'a', { sealing: 'plain' })).not.toThrow();
    expect(() =>
      createSubagentLogger('parent', 'agent', join(root, 'logs'), { sealing: 'plain' }),
    ).not.toThrow();
  });
});

describe('the readers', () => {
  it('state their sealing: a transcript page and the replay-log validation', async () => {
    const access = await projectAccess();

    // @ts-expect-error a reader states its sealing too
    expect(() => readSubagentTranscriptPage(join(root, 'none.jsonl'))).toThrow(TypeError);
    // @ts-expect-error a page offset alone states nothing about sealing
    expect(() => readSubagentTranscriptPage(join(root, 'none.jsonl'), { offset: 0 })).toThrow(
      TypeError,
    );
    // @ts-expect-error a reader states its sealing too
    expect(() => validateWorkspaceSessionReplayLog(access, 'session_a')).toThrow(TypeError);

    expect(readSubagentTranscriptPage(join(root, 'none.jsonl'), { sealing: 'plain' })).toBe(
      undefined,
    );
  });
});

describe('the tool-result spill store', () => {
  it('states its sealing and is given the host directory it lives in', async () => {
    // @ts-expect-error the options are required
    expect(() => createNodeToolResultSpillStore()).toThrow();
    // @ts-expect-error the parent directory is the host's to give: there is no shared temporary default
    expect(() => createNodeToolResultSpillStore({ sealing: 'plain' })).toThrow();
    // @ts-expect-error the sealing decision is required
    expect(() => createNodeToolResultSpillStore({ parentDirectory: root })).toThrow();

    const store = createNodeToolResultSpillStore({ parentDirectory: root, sealing: 'plain' });
    await store.shutdown();
  });
});

describe('the edit checkpoint store', () => {
  it('states its sealing, which it applies to the state it keeps its checkpoints in', async () => {
    const access = await projectAccess();
    const mutation = createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'sealing-required test',
    });

    // @ts-expect-error the sealing decision is required
    expect(() => new EditCheckpointStore({ authority: access.authority, mutation })).toThrow(
      TypeError,
    );

    expect(
      () => new EditCheckpointStore({ authority: access.authority, mutation, sealing: 'plain' }),
    ).not.toThrow();
  });
});
