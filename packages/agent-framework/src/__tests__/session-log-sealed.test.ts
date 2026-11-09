/**
 * Sealed session logs in the PROJECT store (secure conversation): the Workspace log pair
 * routes every line and sidecar through agent-session's one stored-append module, and the project
 * store reads its replay logs with the sealing it seals its records with — so a sealed log rebuilds a
 * session when it can be opened, and is counted as locked, corrupt or unsupported, never crashes a
 * listing, when it cannot. `/validate-session` reads the same log through the same pair.
 *
 * A project WRITE needs the Linux stable-root host, so the cases where the Workspace sink
 * writes are Linux-only; the logs the read cases need are written beside the project with the Node
 * sink, and every read runs everywhere.
 */
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArtifactLockedError } from '@robota-sdk/agent-core';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { FileSessionLogger } from '@robota-sdk/agent-session';
import { NodeSessionLogSink } from '@robota-sdk/agent-session/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WorkspaceSessionLogSink,
  WorkspaceSessionLogSource,
} from '../interactive/workspace-session-io.js';
import {
  createProjectSessionStore,
  createUserPromptHistoryFile,
} from '../interactive/node-session-stores.js';
import { validateWorkspaceSessionReplayLog } from '../interactive/workspace-session-replay-validation.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type { ISessionStoreOptions } from '@robota-sdk/agent-session/node';

const CANARY = 'CANARY-0b7d-what-the-project-session-said';
const SESSION = 'session_sealed_replay';
const linux = process.platform === 'linux';

type TSealer = ReturnType<typeof createTestArtifactSealer>;

let cwd: string;

beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-project-sealed-log-')));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const logsDirectory = (): string => join(cwd, '.agent', 'logs');

function message(id: string, role: 'user' | 'assistant', content: string, second: number) {
  return {
    id,
    role,
    content,
    state: 'complete',
    timestamp: `2026-11-01T00:00:0${second}.000Z`,
  };
}

/** A replay log as a project session writes it, sealed with `sealer`; two values large enough for sidecars. */
function writeLog(sealer: TSealer | undefined): void {
  const sealing: ISessionStoreOptions['sealing'] = sealer === undefined ? 'plain' : { sealer };
  const logger = new FileSessionLogger(new NodeSessionLogSink(logsDirectory(), { sealing }), {
    externalPayloadThresholdBytes: 256,
  });
  logger.log(SESSION, 'session_init', {
    cwd,
    provider: 'scripted',
    model: 'scripted',
    systemPrompt: '',
    systemPromptLength: 0,
    toolSchemas: [],
  });
  logger.log(SESSION, 'history_mutation', {
    mutation: 'append_message',
    index: 0,
    message: message('u1', 'user', CANARY, 1),
  });
  logger.log(SESSION, 'history_mutation', {
    mutation: 'append_message',
    index: 1,
    message: message('a1', 'assistant', CANARY.repeat(20), 2),
  });
  logger.log(SESSION, 'history_mutation', {
    mutation: 'append_message',
    index: 2,
    message: message('a2', 'assistant', `${CANARY.repeat(20)}!`, 3),
  });
}

async function project(): Promise<{
  readonly access: Awaited<ReturnType<typeof createTrustedProjectAccessFixture>>;
  readonly sessions: ReturnType<typeof getWorkspaceProjectStateStorage>;
  readonly logs: ReturnType<typeof getWorkspaceProjectStateStorage>;
}> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return {
    access,
    sessions: getWorkspaceProjectStateStorage(access.authority, 'sessions'),
    logs: getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
  };
}

async function storeWith(sealer: TSealer | undefined) {
  const { sessions, logs } = await project();
  return createProjectSessionStore(sessions, logs, {
    sealing: sealer === undefined ? 'plain' : { sealer },
  });
}

function logFile(): string {
  return join(logsDirectory(), `${SESSION}.jsonl`);
}

describe('project replay recovery from a sealed or broken log', () => {
  it('rebuilds the session, sidecars included, when the log opens', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    expect(readFileSync(logFile(), 'utf8')).not.toContain(CANARY);

    const store = await storeWith(sealer);
    const outcome = store.load(SESSION);
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    expect(outcome.record.id).toBe(SESSION);
    expect(outcome.record.cwd).toBe(cwd);
    expect(outcome.record.messages.map((item) => item.content)).toEqual([
      CANARY,
      CANARY.repeat(20),
      `${CANARY.repeat(20)}!`,
    ]);
    expect(store.list().map((entry) => entry.id)).toEqual([SESSION]);
  });

  it('counts the session as locked while the keys are locked, and as no keys in a plain store', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    sealer.lock();
    const store = await storeWith(sealer);
    expect(store.load(SESSION)).toEqual({ status: 'locked' });
    expect(store.list()).toEqual([]);
    expect(store.scan?.().locked).toBe(1);

    const plain = await storeWith(undefined);
    expect(plain.load(SESSION)).toEqual({ status: 'locked', reason: 'no-keys' });
    expect(plain.scan?.()).toMatchObject({ locked: 0, noKeys: 1 });
  });

  it('reports a sealed line that does not open as corrupt, with fixed text', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    writeFileSync(logFile(), `${readFileSync(logFile(), 'utf8')}RSL1:torn-or-damaged\n`);
    const outcome = (await storeWith(sealer)).load(SESSION);
    if (outcome.status !== 'corrupt') throw new Error(`expected corrupt, got ${outcome.status}`);
    expect(outcome.issues).toEqual([
      {
        path: '',
        message:
          'a sealed line of the session log does not open for this session: it is damaged or sealed with other keys',
      },
    ]);
  });

  it('reports a log line a newer build sealed as unsupported', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    writeFileSync(logFile(), `${readFileSync(logFile(), 'utf8')}RSL2:from-a-newer-build\n`);
    expect((await storeWith(sealer)).load(SESSION)).toEqual({
      status: 'unsupported',
      schemaVersion: undefined,
    });
  });

  it('reports sealed sidecars swapped with each other as corrupt, with fixed text', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    const directory = join(logsDirectory(), `${SESSION}.payloads`);
    const [left, right] = readdirSync(directory).map((name) => join(directory, name));
    const leftBytes = readFileSync(left as string);
    writeFileSync(left as string, readFileSync(right as string));
    writeFileSync(right as string, leftBytes);

    const store = await storeWith(sealer);
    const outcome = store.load(SESSION);
    if (outcome.status !== 'corrupt') throw new Error(`expected corrupt, got ${outcome.status}`);
    expect(outcome.issues).toEqual([
      {
        path: '',
        message: 'a payload of the session log could not be read or does not match its reference',
      },
    ]);
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
    // One bad log does not take the listing down.
    expect(store.list().map((entry) => [entry.id, entry.outcome.status])).toEqual([
      [SESSION, 'corrupt'],
    ]);
  });
  it('reports a plain log whose sidecar is missing as corrupt instead of failing the listing', async () => {
    writeLog(undefined);
    rmSync(join(logsDirectory(), `${SESSION}.payloads`), { recursive: true, force: true });
    const store = await storeWith(undefined);
    expect(store.load(SESSION)).toEqual({
      status: 'corrupt',
      issues: [
        {
          path: '',
          message: 'a payload of the session log could not be read or does not match its reference',
        },
      ],
    });
    expect(store.list().map((entry) => [entry.id, entry.outcome.status])).toEqual([
      [SESSION, 'corrupt'],
    ]);
  });
});

describe('the Workspace log source with a sealer', () => {
  it('opens sealed lines and sidecars by its session id, and meets them as no keys when plain', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    const { logs } = await project();
    const source = new WorkspaceSessionLogSource(logs, SESSION, { sealing: { sealer } });
    expect(source.readText()).toContain(CANARY);
    expect(source.readStoredLines()?.some((stored) => stored.kind === 'lines')).toBe(true);
    // Every sidecar opens, and the values the log externalized are in them.
    const opened = readdirSync(join(logsDirectory(), `${SESSION}.payloads`)).map((name) =>
      Buffer.from(source.readBytes(`${SESSION}.payloads/${name}`, 1 << 20) ?? []).toString(),
    );
    expect(opened.length).toBeGreaterThan(1);
    expect(opened.some((text) => text.includes(CANARY))).toBe(true);

    const plain = new WorkspaceSessionLogSource(logs, SESSION, { sealing: 'plain' });
    expect(() => plain.readText()).toThrow(ArtifactLockedError);
    expect(
      new WorkspaceSessionLogSource(logs, 'absent_session', { sealing: 'plain' }).readStoredLines(),
    ).toBeUndefined();
  });

  it('holds a sealed sidecar to the plaintext budget exactly', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    const { logs } = await project();
    const source = new WorkspaceSessionLogSource(logs, SESSION, { sealing: { sealer } });
    const [name] = readdirSync(join(logsDirectory(), `${SESSION}.payloads`));
    const full = source.readBytes(`${SESSION}.payloads/${name}`, 1 << 20) as Uint8Array;
    expect(source.readBytes(`${SESSION}.payloads/${name}`, full.byteLength)?.byteLength).toBe(
      full.byteLength,
    );
    expect(() => source.readBytes(`${SESSION}.payloads/${name}`, full.byteLength - 1)).toThrowError(
      expect.objectContaining({ code: 'MAX_TOTAL_BYTES_EXCEEDED' }),
    );
  });
});

describe.runIf(linux)('the Workspace log sink with a sealer', () => {
  it('writes plain lines and content-addressed sidecars when plain', async () => {
    const { logs } = await project();
    const sink = new WorkspaceSessionLogSink(logs, { sealing: 'plain' });
    sink.append(SESSION, '{"a":1}\n');
    new WorkspaceSessionLogSink(logs, { sealing: 'plain' }).append(SESSION, '{"b":2}\n');
    const serialized = JSON.stringify(CANARY.repeat(4));
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    const reference = sink.writeJson(SESSION, sha256, serialized);
    expect(readFileSync(logFile(), 'utf8')).toBe('{"a":1}\n{"b":2}\n');
    expect(reference.relativePath).toBe(`${SESSION}.payloads/${sha256}.json`);
    expect(readFileSync(join(logsDirectory(), reference.relativePath), 'utf8')).toBe(serialized);
  });

  it('seals each append and each sidecar, under a random name, written once', async () => {
    const { logs } = await project();
    const sealer = createTestArtifactSealer();
    const sink = new WorkspaceSessionLogSink(logs, { sealing: { sealer } });
    sink.append(SESSION, `{"text":"${CANARY}"}\n`);
    const serialized = JSON.stringify(CANARY.repeat(4));
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    const first = sink.writeJson(SESSION, sha256, serialized);
    expect(sink.writeJson(SESSION, sha256, serialized)).toEqual(first);

    expect(readFileSync(logFile(), 'utf8')).toMatch(/^\nRSL1:[A-Za-z0-9_-]+\n$/);
    expect(first.relativePath).toMatch(
      /^session_sealed_replay\.payloads\/[A-Za-z0-9_-]{22}\.sealed$/,
    );
    expect(readdirSync(join(logsDirectory(), `${SESSION}.payloads`))).toHaveLength(1);
    const stored = readFileSync(join(logsDirectory(), first.relativePath));
    expect(stored.includes(Buffer.from(CANARY))).toBe(false);
    const source = new WorkspaceSessionLogSource(logs, SESSION, { sealing: { sealer } });
    expect(Buffer.from(source.readBytes(first.relativePath, 1 << 20) ?? []).toString()).toBe(
      serialized,
    );
  });
});

describe('/validate-session over a sealed project log', () => {
  it('validates the opened log, and throws ArtifactLockedError with its reason when it cannot', async () => {
    const sealer = createTestArtifactSealer();
    writeLog(sealer);
    const { access } = await project();
    expect(
      validateWorkspaceSessionReplayLog(access, SESSION, { sealing: { sealer } }).entryCount,
    ).toBe(4);

    sealer.lock();
    expect(() =>
      validateWorkspaceSessionReplayLog(access, SESSION, { sealing: { sealer } }),
    ).toThrowError(expect.objectContaining({ code: 'ARTIFACT_LOCKED', reason: 'locked' }));
    expect(() =>
      validateWorkspaceSessionReplayLog(access, SESSION, { sealing: 'plain' }),
    ).toThrowError(expect.objectContaining({ code: 'ARTIFACT_LOCKED', reason: 'no-keys' }));
  });
});

describe('the user prompt-history file', () => {
  it('is plain, byte for byte, unless a sealing is given', async () => {
    const path = join(cwd, 'state', 'history.jsonl');
    const entry = { at: '2026-11-01T00:00:00.000Z', sessionId: 's1', project: cwd, text: CANARY };
    createUserPromptHistoryFile(path, { sealing: 'plain' }).append(entry);
    expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(entry)}\n`);

    const sealed = join(cwd, 'state', 'sealed-history.jsonl');
    createUserPromptHistoryFile(sealed, { sealing: { sealer: createTestArtifactSealer() } }).append(
      entry,
    );
    expect(readFileSync(sealed, 'utf8')).toMatch(/^\nRSL1:[A-Za-z0-9_-]+\n$/);
  });
});
