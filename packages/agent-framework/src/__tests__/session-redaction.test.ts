/**
 * Redacting text in a saved or live conversation, keeping its shape.
 *
 * The saved half runs on a real store and compares raw bytes; the live half runs a real session
 * against a scripted provider and reads the next request and the file the session saved.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive/interactive-session.js';
import { persistSessionRedaction, redactSessionRecord } from '../index.js';
import { createTestFrameworkHost } from '../testing/framework-host.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

const FACT = 'the vault code is 4471-ZETA';
const GONE = '[forgotten]';
const redact = (value: string): string => value.split(FACT).join(GONE);
const testHost = createTestFrameworkHost();

const dirs: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'session-redaction-')));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function holdingRecord(
  overrides: Partial<IInteractiveSessionRecord> = {},
): IInteractiveSessionRecord {
  const at = new Date('2026-09-01T00:00:00.000Z');
  return {
    id: 'sess_held',
    name: `About ${FACT}`,
    cwd: '/work',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:01.000Z',
    messages: [
      { id: 'm1', role: 'user', content: `Please note ${FACT}.`, timestamp: at, state: 'complete' },
      {
        id: 'm2',
        role: 'assistant',
        content: null,
        timestamp: at,
        state: 'complete',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'Search',
              arguments: JSON.stringify({ query: `find ${FACT}`, path: `/notes/${FACT}.md`, n: 3 }),
            },
          },
        ],
      },
      {
        id: 'm3',
        role: 'tool',
        toolCallId: 'call-1',
        name: 'Search',
        content: `result: ${FACT}`,
        timestamp: at,
        state: 'complete',
      },
      {
        id: 'm4',
        role: 'user',
        content: 'Here is a picture.',
        timestamp: at,
        state: 'complete',
        parts: [
          { type: 'text', text: `caption ${FACT}` },
          { type: 'image_inline', mimeType: 'image/png', data: `AAAA${FACT}` },
          { type: 'image_uri', uri: `file:///pics/${FACT}.png` },
        ],
      },
    ],
    history: [
      {
        id: 'h1',
        timestamp: at,
        category: 'chat',
        type: 'user',
        data: { role: 'user', content: `Please note ${FACT}.` },
      },
    ],
    systemPrompt: 'You are helpful.',
    systemPromptManifest: {
      harnessVersion: 'none',
      sections: [{ id: 'a', source: 'x', characters: 16 }],
    },
    toolSchemas: [
      {
        name: 'Search',
        description: `finds ${FACT}`,
        parameters: { type: 'object', properties: {} },
      },
    ],
    ...overrides,
  } as IInteractiveSessionRecord;
}

describe('redacting a record', () => {
  it('replaces the text wherever the conversation holds it and keeps ids and tool-call pairs', () => {
    const redacted = redactSessionRecord(holdingRecord(), redact);
    expect(redacted).toBeDefined();
    const record = redacted as IInteractiveSessionRecord;
    expect(record.name).toBe(`About ${GONE}`);
    expect(record.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(record.messages[0]).toMatchObject({ content: `Please note ${GONE}.` });
    const call = (
      record.messages[1] as { toolCalls: Array<{ id: string; function: { arguments: string } }> }
    ).toolCalls[0];
    expect(call.id).toBe('call-1');
    expect(JSON.parse(call.function.arguments)).toEqual({
      query: `find ${GONE}`,
      path: `/notes/${FACT}.md`,
      n: 3,
    });
    expect(record.messages[2]).toMatchObject({ toolCallId: 'call-1', content: `result: ${GONE}` });
    expect(record.history?.[0]?.data).toMatchObject({ content: `Please note ${GONE}.` });
    expect(JSON.stringify(record)).not.toContain(`Please note ${FACT}`);
  });

  it('redacts tool arguments that are not JSON as plain text', () => {
    const record = holdingRecord();
    (
      record.messages[1] as { toolCalls: Array<{ function: { arguments: string } }> }
    ).toolCalls[0].function.arguments = `not json ${FACT}`;
    const redacted = redactSessionRecord(record, redact) as IInteractiveSessionRecord;
    const call = (redacted.messages[1] as { toolCalls: Array<{ function: { arguments: string } }> })
      .toolCalls[0];
    expect(call.function.arguments).toBe(`not json ${GONE}`);
  });

  it('drops a provider continuation from a message it changed and keeps the others', () => {
    const record = holdingRecord();
    record.messages[0] = {
      ...record.messages[0],
      metadata: { providerContinuation: 'signed-1', note: 'kept' },
    } as never;
    record.messages[3] = {
      ...record.messages[3],
      content: 'no match here',
      parts: undefined,
      metadata: { providerContinuation: 'signed-2' },
    } as never;
    const redacted = redactSessionRecord(record, redact) as IInteractiveSessionRecord;
    expect(redacted.messages[0].metadata).toEqual({ note: 'kept' });
    expect(redacted.messages[3].metadata).toEqual({ providerContinuation: 'signed-2' });
  });

  it('returns nothing to save for a record that never held the text', () => {
    const clean = holdingRecord({ name: 'plain' });
    const innocent = redactSessionRecord(clean, (value) =>
      value.split('unrelated words').join(GONE),
    );
    expect(innocent).toBeUndefined();
  });

  it('never touches ids, times, paths or binary parts, and drops a manifest only when its prompt changed', () => {
    const original = holdingRecord();
    const redacted = redactSessionRecord(original, redact) as IInteractiveSessionRecord;
    expect(redacted.id).toBe(original.id);
    expect(redacted.createdAt).toBe(original.createdAt);
    expect(redacted.updatedAt).toBe(original.updatedAt);
    expect(redacted.cwd).toBe(original.cwd);
    expect(redacted.messages.map((m) => m.timestamp)).toEqual(
      original.messages.map((m) => m.timestamp),
    );
    expect(redacted.history?.[0]?.id).toBe('h1');
    const parts = (redacted.messages[3] as unknown as { parts: Array<Record<string, string>> })
      .parts;
    expect(parts[0]).toMatchObject({ text: `caption ${GONE}` });
    expect(parts[1]).toEqual({ type: 'image_inline', mimeType: 'image/png', data: `AAAA${FACT}` });
    expect(parts[2]).toEqual({ type: 'image_uri', uri: `file:///pics/${FACT}.png` });
    expect(redacted.toolSchemas).toEqual(original.toolSchemas);
    expect(redacted.systemPromptManifest).toEqual(original.systemPromptManifest);

    const withPrompt = holdingRecord({ systemPrompt: `Remember ${FACT}.` });
    const changed = redactSessionRecord(withPrompt, redact) as IInteractiveSessionRecord;
    expect(changed.systemPrompt).toBe(`Remember ${GONE}.`);
    expect(changed.systemPromptManifest).toBeUndefined();
  });
});

function storeIn(dir: string): NodeSessionStore {
  return new NodeSessionStore(dir, { sealing: 'plain' });
}

describe('redacting a stored record', () => {
  it('rewrites an unheld record once and reports redacted, unchanged and missing', async () => {
    const dir = tempDir();
    const store = storeIn(dir);
    store.save(holdingRecord());
    const file = join(dir, 'sess_held.json');

    expect(await persistSessionRedaction(store, 'sess_held', redact)).toEqual({
      status: 'redacted',
    });
    const after = readFileSync(file, 'utf8');
    // What remains is exactly the four places a redaction must not touch: a path argument, an
    // inline image, an image location and a tool schema.
    expect(after.split(FACT).length - 1).toBe(4);
    expect(after).toContain(GONE);
    expect(JSON.parse(after)).toBeDefined();
    const reloaded = store.load('sess_held');
    expect(reloaded.status).toBe('valid');
    if (reloaded.status === 'valid') {
      expect(reloaded.record.updatedAt).toBe('2026-09-01T00:00:01.000Z');
      expect(reloaded.record.messages).toHaveLength(4);
    }

    expect(await persistSessionRedaction(store, 'sess_held', redact)).toEqual({
      status: 'unchanged',
    });
    expect(readFileSync(file, 'utf8')).toBe(after);
    expect(await persistSessionRedaction(store, 'sess_absent', redact)).toEqual({
      status: 'missing',
    });
  });

  it('refuses a record another writer holds, one with a pending execution, and one it cannot read, writing nothing', async () => {
    const dir = tempDir();
    const store = storeIn(dir);
    store.save(holdingRecord({ id: 'sess_writer' }));
    // A parked round: the call is open (no result yet) and a request waits on it.
    const parked = holdingRecord({ id: 'sess_pending' });
    parked.messages = parked.messages
      .filter((message) => message.id === 'm1' || message.id === 'm2')
      .map((message) =>
        message.role === 'assistant'
          ? { ...message, metadata: { executionId: 'exec-1', providerCallId: 'provider-1' } }
          : message,
      );
    parked.pendingExecution = {
      executionId: 'exec-1',
      requests: [
        {
          executionId: 'exec-1',
          actionId: 'action-1',
          parentCallId: 'provider-1',
          toolCallId: 'call-1',
          toolName: 'Search',
          requestId: 'request-1',
          kind: 'approval',
          data: {},
        },
      ],
    };
    store.save(parked);
    expect(store.load('sess_pending').status).toBe('valid');
    writeFileSync(join(dir, 'sess_broken.json'), `{ not a record ${FACT}`);
    const bytes = (id: string): string => readFileSync(join(dir, `${id}.json`), 'utf8');
    const before = {
      writer: bytes('sess_writer'),
      pending: bytes('sess_pending'),
      broken: bytes('sess_broken'),
    };

    const claim = storeIn(dir).claim('sess_writer');
    try {
      expect(await persistSessionRedaction(store, 'sess_writer', redact)).toEqual({
        status: 'held',
      });
    } finally {
      claim.release();
    }
    expect(await persistSessionRedaction(store, 'sess_pending', redact)).toEqual({
      status: 'pending-execution',
    });
    expect(await persistSessionRedaction(store, 'sess_broken', redact)).toEqual({
      status: 'unreadable',
    });

    expect(bytes('sess_writer')).toBe(before.writer);
    expect(bytes('sess_pending')).toBe(before.pending);
    expect(bytes('sess_broken')).toBe(before.broken);
  });
});

function liveSession(
  dir: string,
  scripted: ReturnType<typeof createScriptedProvider>,
  gate?: { wait?: Promise<void>; entered?: number },
) {
  const provider = gate
    ? {
        ...scripted.provider,
        chat: async (...args: Parameters<typeof scripted.provider.chat>) => {
          gate.entered = (gate.entered ?? 0) + 1;
          await gate.wait;
          return scripted.provider.chat(...args);
        },
      }
    : scripted.provider;
  const store = storeIn(join(dir, 'sessions'));
  const session = new InteractiveSession({
    host: testHost,
    cwd: dir,
    provider,
    bare: true,
    permissionMode: 'bypassPermissions',
    sessionStore: store,
    defaultTools: [],
    sessionName: `Notes on ${FACT}`,
  });
  return { session, store };
}

describe('redacting a live conversation', () => {
  it('cleans an idle session in memory and on disk and tells surfaces to re-read', async () => {
    const dir = tempDir();
    const scripted = createScriptedProvider([{ text: 'Noted.' }, { text: 'Still here.' }]);
    const { session, store } = liveSession(dir, scripted);
    const rewrites: number[] = [];
    session.on('history_rewritten', () => rewrites.push(1));
    try {
      await (
        await session.submit(`Remember ${FACT}`)
      ).completed;

      expect(session.redactConversation(redact)).toBe('redacted');
      expect(rewrites).toHaveLength(1);
      expect(session.getName()).toBe(`Notes on ${GONE}`);

      await (
        await session.submit('What now?')
      ).completed;
      const lastRequest = JSON.stringify(scripted.requests.at(-1));
      expect(lastRequest).not.toContain(FACT);
      expect(lastRequest).toContain(GONE);
      expect(JSON.stringify(session.getFullHistory())).not.toContain(FACT);

      const saved = store.load(session.getStatusSnapshot().sessionId);
      expect(JSON.stringify(saved)).not.toContain(FACT);
      expect(JSON.stringify(saved)).toContain(GONE);

      expect(session.redactConversation(redact)).toBe('unchanged');
      expect(rewrites).toHaveLength(1);
    } finally {
      await session.shutdown();
    }
  });

  it('waits for a running compaction before redacting', async () => {
    const dir = tempDir();
    const scripted = createScriptedProvider([{ text: 'Noted.' }, { text: 'A summary.' }]);
    const gate: { wait?: Promise<void>; entered?: number } = {};
    let release: () => void = () => undefined;
    const { session, store } = liveSession(dir, scripted, gate);
    try {
      await (
        await session.submit(`Remember ${FACT}`)
      ).completed;
      gate.wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const enteredBefore = gate.entered ?? 0;
      const compacting = session.compactContext();
      await vi.waitFor(() => expect(gate.entered).toBeGreaterThan(enteredBefore));
      expect(session.redactConversation(redact)).toBe('busy');
      release();
      await compacting;
      expect(session.redactConversation(redact)).toBe('redacted');
      expect(JSON.stringify(store.load(session.getStatusSnapshot().sessionId))).not.toContain(FACT);
    } finally {
      release();
      await session.shutdown();
    }
  });

  it('waits for a running turn before redacting', async () => {
    const dir = tempDir();
    const scripted = createScriptedProvider([{ text: 'Noted.' }]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { session } = liveSession(dir, scripted, { wait: gate });
    try {
      const submitted = session.submit(`Remember ${FACT}`);
      await vi.waitFor(() => expect(session.getLocalActivityStatus()).toBe('working'));
      expect(session.redactConversation(redact)).toBe('busy');
      release();
      await (
        await submitted
      ).completed;
      expect(session.redactConversation(redact)).toBe('redacted');
      expect(JSON.stringify(session.getFullHistory())).not.toContain(FACT);
    } finally {
      release();
      await session.shutdown();
    }
  });
});
