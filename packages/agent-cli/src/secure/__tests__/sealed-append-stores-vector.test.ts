/**
 * The append stores over the PRODUCTION sealer, pinned by checked-in known answers (secure
 * conversation). The stores' own cases run against a test double in agent-session and
 * agent-framework; this is the join the product relies on once secure mode is on: lines and sidecars
 * `KeyHolderArtifactSealer` wrote, read back by the prompt-history reader and by project replay
 * recovery, with exactly the entries, skips and locked counts a person would be shown.
 *
 * `prompt-history-v1.sealed` is slice 1's known answer: six lines two writer epochs sealed. Here its
 * lines are mixed with plain lines, a damaged line, a line a newer build sealed, a torn append, and an
 * append still in progress, as a real file can hold them. `subagent-log-v1.sealed` and its one
 * sidecar were sealed once, to the fixed master key, by the Node log sink (a subagent child's log),
 * and checked in: sealing draws fresh randomness, so neither can be recomputed.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WorkspaceTrustService,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import { createProjectSessionStore } from '@robota-sdk/agent-framework/node';
import { parseKeyring } from '@robota-sdk/agent-keyring';
import { loadSessionLogEntries } from '@robota-sdk/agent-session';
import { NodePromptHistoryFile, NodeSessionLogSource } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it } from 'vitest';

import { KeyHolderArtifactSealer } from '@robota-sdk/agent-local-host';
import { KeyHolder } from '@robota-sdk/agent-local-host';
import { createMemoryKeyringStore } from './helpers.js';

import { createNodeWorkspaceProjectFiles } from '@robota-sdk/agent-framework/node';
import type { TWorkspaceProjectStateDirectories } from '@robota-sdk/agent-framework';
import type { TArtifactSealing } from '@robota-sdk/agent-core';
import type { IPromptHistoryBlock, IPromptHistoryEntry } from '@robota-sdk/agent-interface/session';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const FIXTURE_RECOVERY_KEY = 'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK';
const keyring = parseKeyring(readFileSync(fixture('keyring-v1.json'), 'utf8'));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** A sealer over a holder that never unlocked: it seals, and every open says locked. */
function lockedSealer(): KeyHolderArtifactSealer {
  return new KeyHolderArtifactSealer(
    new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } }),
  );
}

async function unlockedSealer(): Promise<KeyHolderArtifactSealer> {
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY });
  return new KeyHolderArtifactSealer(holder);
}

async function readHistory(
  path: string,
  sealing: TArtifactSealing,
  blockBytes?: number,
): Promise<{
  readonly entries: IPromptHistoryEntry[];
  readonly skippedLines: number;
  readonly locked: number;
  readonly noKeys: number;
  readonly blocks: number;
}> {
  const file = new NodePromptHistoryFile(path, {
    sealing,
    ...(blockBytes === undefined ? {} : { blockBytes }),
  });
  const blocks: IPromptHistoryBlock[] = [];
  for await (const block of file.read({ signal: new AbortController().signal })) blocks.push(block);
  return {
    entries: blocks.flatMap((block) => [...block.entries]),
    skippedLines: blocks.reduce((sum, block) => sum + block.skippedLines, 0),
    locked: blocks.reduce((sum, block) => sum + (block.unreadable?.locked ?? 0), 0),
    noKeys: blocks.reduce((sum, block) => sum + (block.unreadable?.noKeys ?? 0), 0),
    blocks: blocks.length,
  };
}

const historyEntry = (at: string, sessionId: string, text: string): IPromptHistoryEntry => ({
  at,
  sessionId,
  project: '/work/kat',
  text,
});

/** What the six fixture lines open to, in file order (slice 1's known answer). */
const SEALED = {
  aFirst: historyEntry('2026-11-01T00:01:00.000Z', 'session_kat_a', 'first prompt from writer A'),
  bFirst: historyEntry('2026-11-01T00:01:30.000Z', 'session_kat_b', 'first prompt from writer B'),
  aSecond: historyEntry('2026-11-01T00:02:00.000Z', 'session_kat_a', 'second prompt from writer A'),
  aTwoLines: historyEntry(
    '2026-11-01T00:03:00.000Z',
    'session_kat_a',
    'a prompt over\ntwo lines from writer A',
  ),
  bSecond: historyEntry(
    '2026-11-01T00:03:30.000Z',
    'session_kat_b',
    'second prompt from writer B, café',
  ),
  bThird: historyEntry('2026-11-01T00:04:00.000Z', 'session_kat_b', 'third prompt from writer B'),
};
const PLAIN_BEFORE = historyEntry(
  '2026-11-01T00:00:30.000Z',
  'session_old',
  'a plain prompt from before sealing',
);
const PLAIN_BETWEEN = historyEntry(
  '2026-11-01T00:02:30.000Z',
  'session_plain',
  'a plain prompt from a process that seals nothing',
);

/** Changes one base64url character in the middle, keeping the line's spelling canonical. */
function damaged(line: string): string {
  const middle = Math.floor(line.length / 2);
  return `${line.slice(0, middle)}${line[middle] === 'A' ? 'B' : 'A'}${line.slice(middle + 1)}`;
}

/**
 * The fixture's lines as a real history can hold them, oldest first: plain lines before and between
 * the sealed ones, slice 1's line 2 damaged, a line a newer build sealed, a torn append (the first 40
 * base64url characters of line 4) followed by line 4 appended whole, and line 5's start still being
 * appended at the end.
 */
function composedHistory(): string {
  const lines = readFileSync(fixture('prompt-history-v1.sealed'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const sealed = (line: string): string => `\n${line}\n`;
  const [l0, l1, l2, l3, l4, l5] = lines as [string, string, string, string, string, string];
  const path = join(temp('sealed-history-vector-'), 'history.jsonl');
  writeFileSync(path, `${JSON.stringify(PLAIN_BEFORE)}\n`);
  appendFileSync(path, sealed(l0));
  appendFileSync(path, sealed(l1));
  appendFileSync(path, sealed(damaged(l2)));
  appendFileSync(path, 'RSL2:AAECAwQFBgcICQoLDA0ODw\n');
  appendFileSync(path, `${JSON.stringify(PLAIN_BETWEEN)}\n`);
  appendFileSync(path, sealed(l3));
  appendFileSync(path, `\n${l4.slice(0, 'RSL1:'.length + 40)}`);
  appendFileSync(path, sealed(l4));
  appendFileSync(path, sealed(l5));
  appendFileSync(path, `\n${l5.slice(0, 61)}`);
  return path;
}

describe('a prompt history holding the sealed known-answer lines', () => {
  it('lists every entry that opens, newest first, and skips damage, newer lines and the torn append', async () => {
    const path = composedHistory();
    const sealing = { sealer: await unlockedSealer() };
    for (const blockBytes of [undefined, 160]) {
      const read = await readHistory(path, sealing, blockBytes);
      expect(read.entries).toEqual([
        SEALED.bThird,
        SEALED.bSecond,
        SEALED.aTwoLines,
        PLAIN_BETWEEN,
        SEALED.bFirst,
        SEALED.aFirst,
        PLAIN_BEFORE,
      ]);
      expect(read).toMatchObject({ skippedLines: 3, locked: 0, noKeys: 0 });
    }
    expect((await readHistory(path, sealing, 160)).blocks).toBeGreaterThan(3);
  });

  it('counts every sealed line as locked while the keys are locked, and lists the plain ones', async () => {
    const path = composedHistory();
    const read = await readHistory(path, { sealer: lockedSealer() });
    expect(read.entries).toEqual([PLAIN_BETWEEN, PLAIN_BEFORE]);
    // The damaged line cannot be told from an intact one without the keys; the torn append can, by
    // its length, and is skipped as damage.
    expect(read).toMatchObject({ skippedLines: 2, locked: 6, noKeys: 0 });
  });

  it('counts every sealed line as no keys in a process that seals nothing', async () => {
    const path = composedHistory();
    const read = await readHistory(path, 'plain');
    expect(read.entries).toEqual([PLAIN_BETWEEN, PLAIN_BEFORE]);
    expect(read).toMatchObject({ skippedLines: 1, locked: 0, noKeys: 7 });
  });
});

/** The sealed data key a line starts with: what every line of one writer epoch shares. */
function sealedKeyOf(line: string): string {
  return Buffer.from(line.slice('RSL1:'.length), 'base64url').subarray(0, 93).toString('hex');
}

describe('two writers appending to one prompt history', () => {
  it('reads back every entry of both, in file order, each writer under an epoch of its own', async () => {
    const path = join(temp('sealed-history-writers-'), 'history.jsonl');
    // Two processes that never unlocked, each with its own sealer and so its own writer epoch.
    const writers = [lockedSealer(), lockedSealer()].map(
      (sealer) => new NodePromptHistoryFile(path, { sealing: { sealer } }),
    );
    const written = Array.from({ length: 12 }, (_, index) =>
      historyEntry(
        `2026-11-02T00:00:${String(index).padStart(2, '0')}.000Z`,
        `w${index % 2}`,
        `p${index}`,
      ),
    );
    written.forEach((entry, index) => writers[index % 2]?.append(entry));

    const read = await readHistory(path, { sealer: await unlockedSealer() }, 256);
    expect(read.entries).toEqual([...written].reverse());
    expect(read).toMatchObject({ skippedLines: 0, locked: 0, noKeys: 0 });

    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    const epochs = [0, 1].map(
      (writer) => new Set(lines.filter((_, index) => index % 2 === writer).map(sealedKeyOf)),
    );
    expect(epochs.map((keys) => keys.size)).toEqual([1, 1]);
    expect([...(epochs[0] ?? [])][0]).not.toBe([...(epochs[1] ?? [])][0]);
  });
});

const LOG_ID = 'agent_kat_v1';
const SIDECAR = 'PV3nS9Xln_SZLKKdnIjS_A.sealed';
const ASSISTANT_CONTENT = `known-answer sidecar content ${'0123456789'.repeat(8)}`;
const ASSISTANT_SERIALIZED = JSON.stringify({
  id: 'a1',
  role: 'assistant',
  content: ASSISTANT_CONTENT,
  state: 'complete',
  timestamp: '2026-11-01T00:10:03.000Z',
});

/** The fixture log and its sidecar copied where a log of session `agent_kat_v1` lives under `logs`. */
function placeLog(logs: string): string {
  mkdirSync(logs, { recursive: true });
  const file = join(logs, `${LOG_ID}.jsonl`);
  writeFileSync(file, readFileSync(fixture('subagent-log-v1.sealed')));
  cpSync(fixture('subagent-log-v1.payloads'), join(logs, `${LOG_ID}.payloads`), {
    recursive: true,
  });
  return file;
}

describe('sealed subagent log version 1 — known answer', () => {
  it('is one sealed line per append, a newline on both sides, and a sidecar under a random name', () => {
    const text = readFileSync(fixture('subagent-log-v1.sealed'), 'utf8');
    const lines = text.split('\n');
    expect(text.startsWith('\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(lines.filter((line) => line.length > 0)).toHaveLength(4);
    for (const line of lines.filter((candidate) => candidate.length > 0)) {
      expect(line).toMatch(/^RSL1:[A-Za-z0-9_-]+$/);
    }
    expect(text).not.toContain('known-answer');
    const digest = createHash('sha256').update(ASSISTANT_SERIALIZED).digest('hex');
    expect(text).not.toContain(digest);
    expect(readdirSync(fixture('subagent-log-v1.payloads'))).toEqual([SIDECAR]);
    expect(SIDECAR).toMatch(/^[A-Za-z0-9_-]{22}\.sealed$/);
    const sidecar = readFileSync(fixture(`subagent-log-v1.payloads/${SIDECAR}`));
    expect(sidecar.subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(sidecar.includes(Buffer.from('known-answer'))).toBe(false);
  });

  it('opens to exactly the known events, the sidecar hydrated', async () => {
    const file = placeLog(temp('sealed-log-vector-'));
    const source = new NodeSessionLogSource(file, { sealing: { sealer: await unlockedSealer() } });
    const records = (source.readStoredLines() ?? []).flatMap((stored) =>
      stored.kind === 'lines' && stored.lines[0] !== ''
        ? [stored.lines.map((line) => (JSON.parse(line) as { event: string }).event)]
        : stored.kind === 'lines'
          ? []
          : [[stored.kind]],
    );
    expect(records).toEqual([
      ['session_init'],
      ['history_mutation'],
      ['text_delta', 'text_delta'],
      ['history_mutation'],
    ]);
    const entries = loadSessionLogEntries(source);
    expect(entries.map((entry) => [entry.event, entry.timestamp])).toEqual([
      ['session_init', '2026-11-01T00:10:00.000Z'],
      ['history_mutation', '2026-11-01T00:10:01.000Z'],
      ['text_delta', '2026-11-01T00:10:02.000Z'],
      ['text_delta', '2026-11-01T00:10:02.500Z'],
      ['history_mutation', '2026-11-01T00:10:03.000Z'],
    ]);
    expect(entries[4]?.message).toMatchObject({
      id: 'a1',
      role: 'assistant',
      content: ASSISTANT_CONTENT,
      state: 'complete',
    });
  });

  async function projectStore(sealing: TArtifactSealing) {
    const root = temp('sealed-log-project-');
    const directories: TWorkspaceProjectStateDirectories = {
      sessions: join('.agent', 'sessions'),
      'session-logs': join('.agent', 'logs'),
      memory: join('.agent', 'memory'),
      checkpoints: join('.agent', 'checkpoints'),
    };
    placeLog(join(root, '.agent', 'logs'));
    const snapshot = { state: 'trusted' as const, generation: 1 };
    const access = await new WorkspaceTrustService({
      projectFiles: createNodeWorkspaceProjectFiles(),
      identityResolver: {
        resolve: () => ({
          repositoryKey: `fixture:${root}`,
          displayPath: root,
          worktreeRoot: root,
        }),
      },
      projectStateDirectories: directories,
      store: {
        inspect: async () => snapshot,
        grant: async () => snapshot,
        revoke: async () => ({ state: 'revoked' as const, generation: 2 }),
      },
    }).inspect(root);
    if (access.status !== 'trusted') throw new Error('expected trusted project access');
    return createProjectSessionStore(
      getWorkspaceProjectStateStorage(access.authority, 'sessions'),
      getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
      { sealing },
    );
  }

  it('rebuilds exactly the known session through project replay recovery', async () => {
    const store = await projectStore({ sealer: await unlockedSealer() });
    const outcome = store.load(LOG_ID);
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    expect({
      id: outcome.record.id,
      cwd: outcome.record.cwd,
      createdAt: outcome.record.createdAt,
      updatedAt: outcome.record.updatedAt,
    }).toEqual({
      id: LOG_ID,
      cwd: '/work/kat',
      createdAt: '2026-11-01T00:10:00.000Z',
      updatedAt: '2026-11-01T00:10:03.000Z',
    });
    expect(
      outcome.record.messages.map((message) => [message.id, message.role, message.content]),
    ).toEqual([
      ['u1', 'user', 'known-answer subagent task'],
      ['a1', 'assistant', ASSISTANT_CONTENT],
    ]);
  });

  it('counts the session as locked while the keys are locked, and as no keys in a plain store', async () => {
    const locked = await projectStore({ sealer: lockedSealer() });
    expect(locked.load(LOG_ID)).toEqual({ status: 'locked' });
    expect(locked.scan?.()).toEqual({ entries: [], locked: 1 });

    const plain = await projectStore('plain');
    expect(plain.load(LOG_ID)).toEqual({ status: 'locked', reason: 'no-keys' });
  });
});
