import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  IdeaBook,
  IdeaRefusedError,
  createFileIdeaStore,
  createIdeaTools,
  createMemoryIdeaStore,
} from '../index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ideas-'));
  dirs.push(dir);
  return dir;
}

let tick = 0;
const clock = (): Date => new Date(Date.UTC(2026, 10, 14, 0, 0, tick++));

describe.each([
  ['memory', () => createMemoryIdeaStore()],
  ['file', () => createFileIdeaStore(fileDir())],
])('idea book over a %s store', (_name, makeStore) => {
  it('keeps ideas newest first with normalized tags, and marks those the agent suggests', async () => {
    const book = new IdeaBook({ store: makeStore(), now: clock });
    await book.add({
      text: 'Learn to make kimchi',
      tags: ['Food', 'food', ' cooking '],
      origin: 'owner',
    });
    const suggestion = await book.add({ text: 'A picnic at the river', origin: 'agent' });
    const ideas = await book.list();
    expect(ideas.map((idea) => idea.text)).toEqual([
      'A picnic at the river',
      'Learn to make kimchi',
    ]);
    expect(ideas[1]?.tags).toEqual(['food', 'cooking']);
    expect(suggestion.origin).toBe('agent');
    expect((await book.list({ tag: 'FOOD' })).map((idea) => idea.text)).toEqual([
      'Learn to make kimchi',
    ]);
  });

  it('records what an idea became, archives it out of the list, and removes it', async () => {
    const book = new IdeaBook({ store: makeStore(), now: clock });
    const idea = await book.add({ text: 'Visit Jeju in spring', origin: 'owner' });
    expect((await book.takeUp(idea.id, 'goal:jeju-1')).takenUpAs).toBe('goal:jeju-1');
    await book.archive(idea.id);
    expect(await book.list()).toEqual([]);
    expect((await book.list({ includeArchived: true })).map((entry) => entry.status)).toEqual([
      'archived',
    ]);
    await book.remove(idea.id);
    expect(await book.get(idea.id)).toBeUndefined();
  });

  it('refuses empty ideas, secrets, bad tags and unknown ids, including object property names', async () => {
    const book = new IdeaBook({ store: makeStore(), now: clock });
    await expect(book.add({ text: '  ', origin: 'owner' })).rejects.toThrow(IdeaRefusedError);
    await expect(
      book.add({ text: 'my password: hunter2-very-secret', origin: 'owner' }),
    ).rejects.toThrow(IdeaRefusedError);
    await expect(book.add({ text: 'x', tags: ['two words'], origin: 'owner' })).rejects.toThrow(
      IdeaRefusedError,
    );
    for (const id of ['nope', 'constructor', '__proto__']) {
      expect(await book.get(id)).toBeUndefined();
      await expect(book.archive(id)).rejects.toThrow(IdeaRefusedError);
    }
  });
});

describe('idea tools and file store', () => {
  it('keeps an owner-only file and gives the model a refusal as a message', async () => {
    const dir = fileDir();
    const book = new IdeaBook({ store: createFileIdeaStore(dir), now: clock });
    const tools = Object.fromEntries(createIdeaTools(book).map((tool) => [tool.schema.name, tool]));
    const call = async (name: string, args: Record<string, string | string[]>) =>
      JSON.stringify((await tools[name]!.execute(args, { toolName: name, parameters: {} })).data);
    expect(
      await call('IdeaAdd', { text: 'Try the new ramen place', origin: 'owner', tags: ['food'] }),
    ).toContain('kept');
    expect(
      await call('IdeaAdd', { text: 'my password: hunter2-very-secret', origin: 'owner' }),
    ).toContain('error');
    expect(await call('IdeaList', {})).toContain('Try the new ramen place #food');
    if (process.platform !== 'win32')
      expect(statSync(join(dir, 'ideas.json')).mode & 0o777).toBe(0o600);
  });
});
