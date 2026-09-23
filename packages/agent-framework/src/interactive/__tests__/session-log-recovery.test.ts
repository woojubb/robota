import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTrustedProjectSessionStoreFixture } from '../../testing/trusted-project-state-fixture.js';

const roots: string[] = [];
const timestamp = '2026-09-23T00:00:00.000Z';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function logOnlyStoreText(text: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'robota-log-codec-')));
  roots.push(root);
  const logs = join(root, '.robota', 'logs');
  await mkdir(logs, { recursive: true });
  await writeFile(join(logs, 'log-only.jsonl'), text);
  return createTrustedProjectSessionStoreFixture(root);
}

async function logOnlyStore(lines: readonly unknown[]) {
  return logOnlyStoreText(lines.map((line) => JSON.stringify(line)).join('\n'));
}

function init() {
  return {
    schemaVersion: 1,
    sessionId: 'log-only',
    timestamp,
    event: 'session_init',
    cwd: '/work',
    provider: 'scripted',
    model: 'scripted',
    systemPrompt: '',
    systemPromptLength: 0,
    toolSchemas: [],
  };
}

function append(role: string) {
  return {
    schemaVersion: 1,
    sessionId: 'log-only',
    timestamp,
    event: 'history_mutation',
    mutation: 'append_message',
    index: 0,
    message: { id: 'm1', role, content: 'saved message', state: 'complete', timestamp },
  };
}

describe('replay-only session decode outcomes', () => {
  it('loads and lists a valid replay with its message preserved', async () => {
    const store = await logOnlyStore([init(), append('user')]);

    const outcome = store.load('log-only');
    expect(outcome.status).toBe('valid');
    if (outcome.status !== 'valid') throw new Error('expected a valid replay');
    expect(outcome.record.messages).toEqual([
      {
        id: 'm1',
        role: 'user',
        content: 'saved message',
        state: 'complete',
        timestamp: new Date(timestamp),
      },
    ]);
    expect(store.list()).toEqual([{ id: 'log-only', outcome }]);
  });

  it('reports a malformed-only replay as corrupt in load and list, never missing', async () => {
    const store = await logOnlyStore([init(), append('bogus')]);

    const outcome = store.load('log-only');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status !== 'corrupt') throw new Error('expected located replay corruption');
    expect(outcome.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('role') })]),
    );
    expect(store.list()).toEqual([{ id: 'log-only', outcome }]);
  });

  it('rejects the whole log when a malformed event follows a valid message', async () => {
    const store = await logOnlyStore([init(), append('user'), append('bogus')]);

    const outcome = store.load('log-only');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status !== 'corrupt') throw new Error('expected malformed replay corruption');
    expect(outcome.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('line 3.message.role') }),
      ]),
    );
    expect(store.list()).toEqual([{ id: 'log-only', outcome }]);
  });

  it('reports an unknown ancillary event as corruption in load and list', async () => {
    const store = await logOnlyStore([
      init(),
      append('user'),
      { schemaVersion: 1, sessionId: 'log-only', timestamp, event: 'unknown_ancillary_event' },
    ]);

    const outcome = store.load('log-only');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status !== 'corrupt') throw new Error('expected unknown event corruption');
    expect(outcome.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'line 3.event' })]),
    );
    expect(store.list()).toEqual([{ id: 'log-only', outcome }]);
  });

  it('reports an unsupported event schema version in load and list', async () => {
    const store = await logOnlyStore([
      init(),
      append('user'),
      { ...append('assistant'), schemaVersion: 2 },
    ]);

    const outcome = store.load('log-only');
    expect(outcome).toEqual({ status: 'unsupported', schemaVersion: 2 });
    expect(store.list()).toEqual([{ id: 'log-only', outcome }]);
  });

  it('reports malformed JSON as corruption at its physical line in load and list', async () => {
    const store = await logOnlyStoreText(
      `${JSON.stringify(init())}\n${JSON.stringify(append('user'))}\n{"event":`,
    );

    const outcome = store.load('log-only');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status !== 'corrupt') throw new Error('expected malformed JSON corruption');
    expect(outcome.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'line 3' })]),
    );
    expect(store.list()).toEqual([{ id: 'log-only', outcome }]);
  });
});
