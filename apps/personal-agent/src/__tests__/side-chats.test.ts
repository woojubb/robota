import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SideChatRefusedError, createSideChatBook } from '../side-chats.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function book() {
  const dir = mkdtempSync(join(tmpdir(), 'side-chats-'));
  dirs.push(dir);
  return { dir, sideChats: createSideChatBook(dir, () => new Date('2026-01-02T03:04:05Z')) };
}

describe('side chat records', () => {
  it('lists side chats newest first, once each, with the chat they were started beside', () => {
    const { sideChats } = book();
    sideChats.add({ id: 'first', title: 'Packing list' });
    sideChats.add({ id: 'second', parentId: 'main-1', title: '  How   long is the\nferry? ' });
    sideChats.add({ id: 'first', title: 'Ignored: already recorded' });
    expect(sideChats.list()).toEqual([
      {
        id: 'second',
        parentId: 'main-1',
        title: 'How long is the ferry?',
        createdAt: '2026-01-02T03:04:05.000Z',
      },
      { id: 'first', title: 'Packing list', createdAt: '2026-01-02T03:04:05.000Z' },
    ]);
    expect(sideChats.remove('first')).toBe(true);
    expect(sideChats.remove('first')).toBe(false);
    expect(sideChats.list().map((chat) => chat.id)).toEqual(['second']);
  });

  it('keeps titles short and never a secret', () => {
    const { sideChats } = book();
    expect(sideChats.add({ id: 'a', title: 'x'.repeat(200) }).title).toHaveLength(80);
    expect(sideChats.add({ id: 'b', title: 'password: hunter2-very-secret' }).title).toBe(
      'Side chat',
    );
    expect(sideChats.add({ id: 'c', title: '' }).title).toBe('Side chat');
  });

  it('refuses ids that are not session ids and keeps an owner-only file', () => {
    const { dir, sideChats } = book();
    for (const id of ['../config', '', 'a/b']) {
      expect(() => sideChats.add({ id, title: 't' })).toThrow(SideChatRefusedError);
    }
    expect(() => sideChats.add({ id: 'ok', parentId: '../x', title: 't' })).toThrow(
      SideChatRefusedError,
    );
    sideChats.add({ id: 'ok', title: 't' });
    if (process.platform !== 'win32')
      expect(statSync(join(dir, 'side-chats.json')).mode & 0o777).toBe(0o600);
  });
});
