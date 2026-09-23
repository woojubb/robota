/**
 * Issue #2240 — a session id cannot address a file outside the store, on any of the three sinks.
 *
 * SEC-006 put the id validation at ONE point (`filePath`) so `save`, `load` and `delete` are covered
 * by construction. These cases drive each public sink with a traversal-shaped id and assert the same
 * refusal, so the single point of validation stays the single point: a future refactor that gives
 * one sink its own path building would fail here, not in a code-scanning alert.
 */

import { existsSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function newStore(): { store: NodeSessionStore; root: string; baseDir: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sec-2240-')));
  dirs.push(root);
  const baseDir = path.join(root, 'sessions');
  return { store: new NodeSessionStore(baseDir), root, baseDir };
}

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    messages: [],
  };
}

/** The shapes an attacker reaches for: a parent hop, a nested path, a Windows separator, dot-only. */
const TRAVERSAL_IDS = ['../escape', '..', '.', 'a/b', 'a\\b', '../../etc/passwd', 'x/../../y'];

describe('NodeSessionStore refuses ids that would leave the store (issue #2240)', () => {
  it('load refuses every traversal shape before touching the filesystem', () => {
    const { store } = newStore();
    for (const id of TRAVERSAL_IDS) {
      expect(() => store.load(id), id).toThrow(/Invalid session id/);
    }
  });

  it('save refuses every traversal shape and writes nothing outside the store', () => {
    const { store, root } = newStore();
    for (const id of TRAVERSAL_IDS) {
      expect(() => store.save(record(id)), id).toThrow(/Invalid session id/);
    }
    expect(existsSync(path.join(root, 'escape.json'))).toBe(false);
  });

  it('delete refuses every traversal shape', () => {
    const { store } = newStore();
    for (const id of TRAVERSAL_IDS) {
      expect(() => store.delete(id), id).toThrow(/Invalid session id/);
    }
  });

  it('a well-formed id round-trips inside the store (the control)', () => {
    const { store, baseDir } = newStore();
    store.save(record('session_ok-1.2'));
    expect(existsSync(path.join(baseDir, 'session_ok-1.2.json'))).toBe(true);
    expect(store.load('session_ok-1.2').status).toBe('valid');
  });
});
