/**
 * The product's one answer to "how do this process's session stores seal", as it stands today:
 * secure conversation is not switched on, so the answer is plain and every store the factory builds
 * writes what every earlier build wrote, byte for byte: the pretty-printed record envelope and the
 * prompt-history lines.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { resolveProductSessionSealing } from '../session-sealing.js';
import {
  createProductPromptHistoryFile,
  createProductUserSessionStore,
} from '../session-stores.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const record: IInteractiveSessionRecord = {
  id: 'sess_plain',
  cwd: '/work',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
  messages: [],
};

describe('the product session sealing', () => {
  it('is plain while secure conversation is not switched on', () => {
    expect(resolveProductSessionSealing(createTestProductRuntime())).toBe('plain');
  });

  it('builds stores that write the envelope every earlier build wrote', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'product-session-stores-')));
    roots.push(home);
    createProductUserSessionStore(createTestProductRuntime('test-product', { HOME: home })).save(
      record,
    );

    expect(readFileSync(join(home, '.test-product', 'sessions', 'sess_plain.json'), 'utf8')).toBe(
      JSON.stringify({ schemaVersion: 2, record }, null, 2),
    );
  });

  it('builds the prompt-history file that writes the lines every earlier build wrote', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'product-session-stores-')));
    roots.push(home);
    const entry = { at: '2026-11-01T00:00:00.000Z', sessionId: 's1', project: '/work', text: 'hi' };
    createProductPromptHistoryFile(createTestProductRuntime('test-product', { HOME: home })).append(
      entry,
    );

    expect(readFileSync(join(home, '.test-product', 'history.jsonl'), 'utf8')).toBe(
      `${JSON.stringify(entry)}\n`,
    );
  });
});
