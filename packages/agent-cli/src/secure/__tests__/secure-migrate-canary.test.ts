/**
 * The canary for `secure migrate` (#3679): one unique string typed into every conversation store a
 * state root keeps in plaintext — session records, the prompt history, a subagent transcript and its
 * sidecars (a nested one too), a kept-aside hand-off, a crashed write's temp file, an earlier build's
 * `/editor` buffer and a gone process's scratch; on Linux also a trusted project's records, replay
 * log, edit checkpoints and pending memory candidates. After one migration, answered yes, the string
 * is nowhere under the state root, the project's state directory or the temporary directory, except
 * in what the migration lists and leaves (the SDK's spill directories), and everything it sealed
 * still opens through the store that reads it. Secure mode is turned on through the predicate's own
 * seam, and the keyring is the test fixture's.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
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

import { goneProcessOwner, leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import {
  EditCheckpointStore,
  WorkspaceSessionLogSink,
  createNodeWorkspaceTrustService,
  createProjectSessionStore,
  createWorkspaceProjectMutation,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import {
  readSubagentTranscriptPage,
  resolveSubagentTranscriptPath,
} from '@robota-sdk/agent-framework/node';
import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { FileSessionLogger, loadSessionLogEntries } from '@robota-sdk/agent-session';
import {
  NodePromptHistoryFile,
  NodeSessionLogSink,
  NodeSessionLogSource,
  NodeSessionStore,
} from '@robota-sdk/agent-session/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { KeyHolderArtifactSealer } from '../artifact-sealer.js';
import { KeyHolder } from '../key-holder.js';
import { createKeyringFileStore } from '../keyring-store.js';
import { runSecureCommand } from '../secure-command.js';
import { createMigrationSteps } from '../secure-migrate.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring, scriptedSecureTerminal } from './helpers.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';
import type { IWorkspaceProjectAuthority } from '@robota-sdk/agent-framework';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-9d3f-sealed-by-secure-migrate';
const DAY_MS = 24 * 60 * 60 * 1000;
const linux = process.platform === 'linux';

let home: string;
let temporary: string;
let runtime: ICliRuntimeContext;
let project: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'secure-migrate-canary-')));
  temporary = join(home, 'tmp');
  project = join(home, 'project');
  mkdirSync(temporary);
  runtime = createTestProductRuntime('test-product', { HOME: home });
  overrideProductSecureMode(runtime, true);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function age(path: string, milliseconds: number): void {
  const at = new Date(Date.now() - milliseconds);
  utimesSync(path, at, at);
}

function record(id: string, cwd: string): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: `${CANARY} in ${id}`,
        timestamp: new Date('2026-11-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Two externalized messages, and a third whose payload is a reference to another payload. */
function logConversation(logger: FileSessionLogger, sessionId: string, directory: string): void {
  for (const [index, role] of (['user', 'assistant'] as const).entries()) {
    logger.log(sessionId, 'history_mutation', {
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
  const reference = (serialized: string) => ({
    kind: 'external-payload',
    encoding: 'json',
    sha256: digest(serialized),
    byteLength: Buffer.byteLength(serialized),
    relativePath: `${sessionId}.payloads/${digest(serialized)}.json`,
  });
  const inner = JSON.stringify(`${CANARY} nested `.repeat(8));
  const outer = JSON.stringify(reference(inner));
  writeFileSync(join(directory, `${sessionId}.payloads`, `${digest(inner)}.json`), inner);
  writeFileSync(join(directory, `${sessionId}.payloads`, `${digest(outer)}.json`), outer);
  // Written as an earlier build's sink wrote it: the logger would externalize the digest itself.
  appendFileSync(
    join(directory, `${sessionId}.jsonl`),
    `${JSON.stringify({
      schemaVersion: 1,
      timestamp: '2026-11-01T00:02:00.000Z',
      sessionId,
      event: 'history_mutation',
      mutation: 'append_message',
      index: 2,
      message: {
        id: 'm-2',
        role: 'assistant',
        content: reference(outer),
        state: 'complete',
        timestamp: '2026-11-01T00:02:00.000Z',
      },
    })}\n`,
  );
}

async function projectAuthority(): Promise<IWorkspaceProjectAuthority> {
  const service = createNodeWorkspaceTrustService(
    runtime.layout.userPaths.workspaceTrust,
    runtime.layout.projectStateDirectories,
  );
  const access = await service.inspect(project);
  if (access.status !== 'trusted') throw new Error('expected the project to be trusted');
  return access.authority;
}

function checkpointStore(authority: IWorkspaceProjectAuthority, sealer?: KeyHolderArtifactSealer) {
  return new EditCheckpointStore({
    authority,
    mutation: createWorkspaceProjectMutation(authority, {
      status: 'approved',
      purpose: 'canary checkpoints',
    }),
    sealing: sealer === undefined ? 'plain' : { sealer },
  });
}

/** A trusted project's plain state, as builds before sealing left it (Linux writes project state). */
async function seedProject(): Promise<void> {
  mkdirSync(project);
  execFileSync('git', ['init', '-q', project], { stdio: 'ignore' });
  await createNodeWorkspaceTrustService(
    runtime.layout.userPaths.workspaceTrust,
    runtime.layout.projectStateDirectories,
  ).grant(project);
  const authority = await projectAuthority();
  const sessions = getWorkspaceProjectStateStorage(authority, 'sessions');
  const logs = getWorkspaceProjectStateStorage(authority, 'session-logs');
  createProjectSessionStore(sessions, logs, { sealing: 'plain' }).save(
    record('project_saved', project),
  );
  const logger = new FileSessionLogger(new WorkspaceSessionLogSink(logs, { sealing: 'plain' }), {
    externalPayloadThresholdBytes: 64,
  });
  logger.log('project_replayed', 'history_mutation', {
    mutation: 'append_message',
    index: 0,
    message: {
      id: 'm-0',
      role: 'user',
      content: `${CANARY} replayed `.repeat(8),
      state: 'complete',
      timestamp: '2026-11-01T00:00:00.000Z',
    },
  });
  const checkpoints = checkpointStore(authority);
  writeFileSync(join(project, 'notes.txt'), `${CANARY} before turn 1`);
  for (const turn of [1, 2]) {
    await checkpoints.beginTurn({ sessionId: 'project_saved', prompt: `${CANARY} turn ${turn}` });
    await checkpoints.captureFile(join(project, 'notes.txt'));
    writeFileSync(join(project, 'notes.txt'), `${CANARY} after turn ${turn}`);
    await checkpoints.finalizeTurn();
  }
  const memory = join(project, runtime.layout.projectStateDirectories.memory);
  mkdirSync(memory, { recursive: true });
  writeFileSync(
    join(memory, 'pending.json'),
    JSON.stringify({ version: 1, records: [{ text: CANARY }] }),
  );
}

/** Plaintext with the canary in every store the user state root keeps. */
async function seedStateRoot(): Promise<void> {
  const { keyring } = await fixtureKeyring();
  mkdirSync(runtime.layout.userPaths.secure, { recursive: true });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  const cwd = linux ? project : '/work';
  const sessions = runtime.layout.userPaths.sessions;
  new NodeSessionStore(sessions, { sealing: 'plain' }).save(record('user_saved', cwd));
  writeFileSync(join(sessions, 'user_corrupt.json'), `{"schemaVersion":1,"record":"${CANARY}`);
  const crashed = join(sessions, 'user_saved.json.4242.tmp');
  writeFileSync(crashed, CANARY);
  age(crashed, 10 * 60 * 1000);
  writeFileSync(
    runtime.layout.userPaths.history,
    `${JSON.stringify({ at: '2026-11-01T00:00:00.000Z', sessionId: 'user_saved', project: cwd, text: `${CANARY} prompt` })}\n`,
  );
  const transcript = resolveSubagentTranscriptPath(
    runtime.config.storage.logRoot,
    'user_saved',
    'task_1',
  );
  const subagents = join(runtime.config.storage.logRoot, 'user_saved', 'subagents');
  mkdirSync(join(subagents, 'task_1.payloads'), { recursive: true });
  logConversation(
    new FileSessionLogger(new NodeSessionLogSink(subagents, { sealing: 'plain' }), {
      externalPayloadThresholdBytes: 64,
    }),
    'task_1',
    subagents,
  );
  expect(existsSync(transcript)).toBe(true);
  const aside = join(runtime.layout.userRoot, 'handoff', 'device_1');
  mkdirSync(aside, { recursive: true });
  writeFileSync(join(aside, 'h-1.json'), CANARY);
  writeFileSync(join(aside, '.partial-0d1e'), CANARY);
  const editor = join(temporary, 'test-product-editor-AbC123');
  mkdirSync(editor);
  writeFileSync(join(editor, 'buffer.md'), CANARY);
  age(join(editor, 'buffer.md'), 2 * DAY_MS);
  age(editor, 2 * DAY_MS);
  const scratch = leaveProcessScopedDirectory(
    runtime.layout.userPaths.spill,
    'agent-tool-results-',
    goneProcessOwner(),
  );
  writeFileSync(join(scratch, 'content.txt'), CANARY);
  const sdkSpill = join(temporary, 'agent-tool-results-XyZ987');
  mkdirSync(sdkSpill);
  writeFileSync(join(sdkSpill, 'result.json'), CANARY);
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function withCanary(): string[] {
  return [
    ...filesUnder(runtime.layout.userRoot),
    ...filesUnder(join(project, runtime.layout.projectDirectory)),
    ...filesUnder(temporary),
  ]
    .filter((path) => readFileSync(path).includes(Buffer.from(CANARY)))
    .sort();
}

async function unlockedSealer(): Promise<{ sealer: KeyHolderArtifactSealer; holder: KeyHolder }> {
  const holder = new KeyHolder({
    store: createKeyringFileStore({
      path: runtime.layout.userPaths.keyring,
      root: runtime.layout.userRoot,
    }),
    policy: { idleMs: 0 },
  });
  await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  return { sealer: new KeyHolderArtifactSealer(holder), holder };
}

describe.skipIf(process.platform === 'win32')('secure migrate, end to end', () => {
  // Measured here: 0.8 s on macOS and 1.3 s on Linux, ~0.5 s of it three default-cost scrypt
  // derivations (the keyring has no cheaper cost to give a test); 6.4 s with the CPU limited to a
  // quarter core, where the 5 s default timed out as it did on CI. 20 s is three times that.
  it('leaves the canary nowhere but in what it lists, and everything it sealed still opens', async () => {
    if (linux) await seedProject();
    await seedStateRoot();
    const out: string[] = [];
    const terminal = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE });

    const code = await runSecureCommand(['migrate'], {
      productRuntime: runtime,
      stdout: (text) => out.push(text),
      stderr: (text) => out.push(text),
      stdinIsTTY: true,
      stdoutIsTTY: true,
      openTerminal: () => terminal.session,
      confirm: async () => 'y',
      migrationSteps: createMigrationSteps({ temporaryDirectory: temporary }),
    });

    const printed = out.join('');
    expect(code, printed).toBe(0);
    expect(printed).toContain('test-product secure migrate: done');
    expect(printed).not.toContain(CANARY);
    const sdkSpill = join(temporary, 'agent-tool-results-XyZ987', 'result.json');
    expect(withCanary()).toEqual([sdkSpill]);
    expect(printed).toContain(
      `SDK spill directories, which may be another program's, left as they are: ${join(temporary, 'agent-tool-results-XyZ987')}.`,
    );

    const { sealer, holder } = await unlockedSealer();
    try {
      const store = new NodeSessionStore(runtime.layout.userPaths.sessions, {
        sealing: { sealer },
      });
      expect(store.load('user_saved')).toMatchObject({ status: 'valid' });
      expect(store.load('user_corrupt')).toMatchObject({ status: 'corrupt' });
      const history: string[] = [];
      for await (const block of new NodePromptHistoryFile(runtime.layout.userPaths.history, {
        sealing: { sealer },
      }).read({ signal: new AbortController().signal })) {
        history.push(...block.entries.map((entry) => entry.text));
      }
      expect(history).toEqual([`${CANARY} prompt`]);
      const transcript = resolveSubagentTranscriptPath(
        runtime.config.storage.logRoot,
        'user_saved',
        'task_1',
      );
      const entries = loadSessionLogEntries(
        new NodeSessionLogSource(transcript, { sealing: { sealer } }),
      );
      expect(entries.map((entry) => (entry.message as { content: string }).content)).toEqual([
        `${CANARY} user `.repeat(8),
        `${CANARY} assistant `.repeat(8),
        JSON.parse(JSON.stringify(`${CANARY} nested `.repeat(8))),
      ]);
      expect(readSubagentTranscriptPage(transcript, { sealing: { sealer } })?.lines).toHaveLength(
        3,
      );
      if (linux) {
        const authority = await projectAuthority();
        const projectStore = createProjectSessionStore(
          getWorkspaceProjectStateStorage(authority, 'sessions'),
          getWorkspaceProjectStateStorage(authority, 'session-logs'),
          { sealing: { sealer } },
        );
        expect(projectStore.load('project_saved')).toMatchObject({ status: 'valid' });
        expect(projectStore.load('project_replayed')).toMatchObject({ status: 'valid' });
        const sealedCheckpoints = checkpointStore(authority, sealer);
        const turns = sealedCheckpoints.list('project_saved');
        expect(turns).toHaveLength(2);
        await sealedCheckpoints.rollbackThroughCheckpoint('project_saved', turns[0]!.id);
        expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe(`${CANARY} before turn 1`);
        expect(
          existsSync(join(project, runtime.layout.projectStateDirectories.memory, 'pending.json')),
        ).toBe(false);
      }
    } finally {
      sealer.dispose();
      holder.lock('explicit');
    }
  }, 20_000);
});
