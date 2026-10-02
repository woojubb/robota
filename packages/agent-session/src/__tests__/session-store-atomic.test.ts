/**
 * CORE-019 — SessionStore atomic persistence tests.
 *
 * save() must write via a same-directory temp file + rename so a crash mid-write can
 * never leave a truncated/corrupt JSON in place of the previous record. Observable
 * contract pinned here: (1) roundtrip integrity, (2) no temp-file residue after save,
 * (3) a failure before the write completes leaves the previous record untouched.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { loadedOrMissing } from './store-load-helpers.js';

let baseDir: string;

function createRecord(
  overrides: Partial<IInteractiveSessionRecord> = {},
): IInteractiveSessionRecord {
  return {
    id: 'core-019-atomic',
    cwd: '/tmp',
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: 'original',
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  baseDir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-store-')));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe('SessionStore atomic persistence (CORE-019)', () => {
  it('loads linked resource and audio receipts through a fresh store after a disk roundtrip', () => {
    const record = createRecord({
      messages: [
        {
          id: 'receipt',
          role: 'tool',
          toolCallId: 'call',
          name: 'observe',
          content: '{"saved":true}',
          state: 'complete',
          timestamp: new Date(0),
          parts: [
            {
              type: 'resource_link',
              uri: 'fixture://snapshot',
              name: 'snapshot',
              title: 'State',
              description: 'Persisted receipt',
              mimeType: 'application/json',
              size: 3,
            },
            {
              type: 'resource_embedded',
              uri: 'fixture://text',
              mimeType: 'text/plain',
              text: 'persisted effect',
            },
            { type: 'resource_embedded', uri: 'fixture://binary', blob: 'YmluYXJ5' },
            { type: 'audio_inline', mimeType: 'audio/wav', data: 'YXVkaW8=' },
          ],
        },
      ],
    });
    new NodeSessionStore(baseDir).save(record);
    const loaded = loadedOrMissing(new NodeSessionStore(baseDir), record.id);
    expect(loaded?.messages).toStrictEqual(record.messages);
  });

  it('save() roundtrips and leaves no temp-file residue', () => {
    const store = new NodeSessionStore(baseDir);
    store.save(createRecord());

    const loaded = loadedOrMissing(store, 'core-019-atomic');
    expect(loaded?.messages[0]?.content).toBe('original');

    const files = readdirSync(baseDir);
    expect(files).toEqual(['core-019-atomic.json']);
  });

  it('save() over an existing record replaces it atomically', () => {
    const store = new NodeSessionStore(baseDir);
    store.save(createRecord());
    store.save(
      createRecord({
        messages: [
          {
            id: 'm-0',
            role: 'user',
            content: 'updated',
            timestamp: new Date('2026-08-01T00:00:00.000Z'),
            state: 'complete',
          },
        ],
      }),
    );

    const raw = readFileSync(join(baseDir, 'core-019-atomic.json'), 'utf-8');
    expect(JSON.parse(raw).record.messages[0].content).toBe('updated');
    expect(readdirSync(baseDir)).toEqual(['core-019-atomic.json']);
  });

  it('a failed save leaves the previous record untouched', () => {
    const store = new NodeSessionStore(baseDir);
    store.save(createRecord());

    // Fault injection: a circular record makes JSON.stringify throw before any bytes
    // reach the destination file — the previous record must survive.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      store.save(createRecord({ messages: [circular as unknown as TUniversalMessage] })),
    ).toThrow();

    const loaded = loadedOrMissing(store, 'core-019-atomic');
    expect(loaded?.messages[0]?.content).toBe('original');
    expect(readdirSync(baseDir)).toEqual(['core-019-atomic.json']);
  });
});
