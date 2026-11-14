import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SpaceBook,
  SpaceRefusedError,
  createFileSpaceStore,
  createMemorySpaceStore,
} from '../index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spaces-'));
  dirs.push(dir);
  return dir;
}

describe.each([
  ['memory', () => createMemorySpaceStore()],
  ['file', () => createFileSpaceStore(fileDir())],
])('space book over a %s store', (_name, makeStore) => {
  it('keeps spaces by name with a tag, edits and removes them', async () => {
    const book = new SpaceBook({ store: makeStore() });
    const trip = await book.create({
      name: 'Jeju  trip',
      instructions: 'Budget 1M won. Prefer quiet places.',
    });
    await book.create({ name: 'Apartment', instructions: '' });
    expect((await book.list()).map((space) => space.name)).toEqual(['Apartment', 'Jeju trip']);
    expect(trip.tag).toBe('jeju-trip');
    const edited = await book.update(trip.id, {
      name: 'Jeju trip',
      instructions: 'Budget 2M won.',
    });
    expect(edited.instructions).toBe('Budget 2M won.');
    await book.remove(trip.id);
    expect(await book.get(trip.id)).toBeUndefined();
  });

  it('opens a chat with the own instructions of the person', async () => {
    const book = new SpaceBook({ store: makeStore() });
    const space = await book.create({ name: 'Garden', instructions: 'Organic only.' });
    expect(book.opening(space)).toBe(`Let's work in my space "Garden".\n\nOrganic only.`);
  });

  it('pins library pages once each and names them in the opening', async () => {
    const book = new SpaceBook({ store: makeStore() });
    const space = await book.create({ name: 'Garden', instructions: '' });
    await book.pin(space.id, 'tomatoes');
    const pinned = await book.pin(space.id, 'tomatoes');
    expect(pinned.pages).toEqual(['tomatoes']);
    expect(book.opening(pinned, [{ id: 'tomatoes', title: 'Tomato  beds' }])).toBe(
      `Let's work in my space "Garden".\n\nRead these pages from my library first:\n- Tomato beds (tomatoes)`,
    );
    expect((await book.unpin(space.id, 'tomatoes')).pages).toEqual([]);
    await expect(book.pin('constructor', 'tomatoes')).rejects.toThrow(SpaceRefusedError);
  });

  it('gives a name without ASCII letters a tag that cannot repeat', async () => {
    const book = new SpaceBook({ store: makeStore() });
    const space = await book.create({ name: 'Κρήτη', instructions: '' });
    expect(space.tag).toBe(space.id);
  });

  it('refuses a nameless space, secrets and unknown ids', async () => {
    const book = new SpaceBook({ store: makeStore() });
    await expect(book.create({ name: ' ', instructions: 'x' })).rejects.toThrow(SpaceRefusedError);
    await expect(
      book.create({ name: 'Bank', instructions: 'password: hunter2-very-secret' }),
    ).rejects.toThrow(SpaceRefusedError);
    for (const id of ['nope', 'constructor']) {
      expect(await book.get(id)).toBeUndefined();
      await expect(book.remove(id)).rejects.toThrow(SpaceRefusedError);
    }
  });
});

describe('space file store', () => {
  it('keeps an owner-only file', async () => {
    const dir = fileDir();
    await new SpaceBook({ store: createFileSpaceStore(dir) }).create({
      name: 'Home',
      instructions: '',
    });
    if (process.platform !== 'win32')
      expect(statSync(join(dir, 'spaces.json')).mode & 0o777).toBe(0o600);
  });
});
