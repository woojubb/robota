import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFixtureWebRoot, startHarness } from './harness.js';

import type { IHarness } from './harness.js';

let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

interface IClient {
  get(path: string): Promise<{ status: number; body: any }>;
  send(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: any }>;
}

/** Log in with the access code the way a browser does, then call the API with the cookie it got. */
async function client(started: IHarness): Promise<IClient> {
  const gui = started.local.gui!;
  const login = await fetch(new URL('/__monitor_login', gui.url), {
    method: 'POST',
    body: new URLSearchParams({ code: gui.accessCode }),
    redirect: 'manual',
  });
  const base = new URL(`${login.headers.get('location')!}api/`, gui.url);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const parse = async (response: Response) => ({
    status: response.status,
    body: await response.json(),
  });
  return {
    get: async (path) => parse(await fetch(new URL(path, base), { headers: { cookie } })),
    send: async (method, path, body, headers = { 'x-robota-api': '1' }) =>
      parse(
        await fetch(new URL(path, base), {
          method,
          headers: { cookie, 'content-type': 'application/json', ...headers },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }),
      ),
  };
}

describe('the personal API behind the web UI', () => {
  it('lets the person add, correct and forget what the agent knows, filed as their own word', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    expect((await api.get('wiki/pages')).body).toEqual({ pages: [] });

    const created = await api.send('POST', 'wiki/pages', {
      title: 'Mina',
      kind: 'person',
      text: 'Mina drinks green tea',
    });
    expect(created).toEqual({ status: 200, body: { pageId: 'mina' } });
    const added = await api.send('POST', 'wiki/pages/mina/claims', { text: 'Mina lives in Busan' });
    expect(added.status).toBe(200);

    const page = (await api.get('wiki/pages/mina')).body.page;
    expect(page.claims.map((claim: any) => [claim.text, claim.source.origin])).toEqual([
      ['Mina drinks green tea', 'owner'],
      ['Mina lives in Busan', 'owner'],
    ]);

    const tea = page.claims[0].id as string;
    const corrected = await api.send('POST', 'wiki/pages/mina/claims', {
      text: 'Mina drinks barley tea',
      supersedes: tea,
    });
    expect(corrected.status).toBe(200);
    const after = (await api.get('wiki/pages/mina')).body.page;
    expect(after.claims.find((claim: any) => claim.id === tea).validTo).toBeDefined();

    expect((await api.get('search?q=busan')).body.results).toEqual([
      expect.objectContaining({
        page: expect.objectContaining({ id: 'mina' }),
        matches: ['Mina lives in Busan'],
      }),
    ]);

    const busan = after.claims.find((claim: any) => claim.text === 'Mina lives in Busan').id;
    expect((await api.send('POST', 'wiki/forget', { claimId: busan })).body).toEqual({
      removed: 1,
    });
    expect((await api.get('search?q=busan')).body.results).toEqual([]);

    expect((await api.send('POST', 'wiki/forget', { pageId: 'mina' })).body).toEqual({
      removed: 2,
    });
    expect((await api.get('wiki/pages/mina')).status).toBe(404);
    const log = (await api.get('wiki/log')).body.entries;
    expect(JSON.stringify(log)).not.toContain('mina');
    expect(log[0]).toEqual(expect.objectContaining({ action: 'forget' }));

    // Looking at the check changes nothing: no entry is added to the change log.
    expect((await api.get('wiki/lint')).status).toBe(200);
    expect((await api.get('wiki/log')).body.entries).toEqual(log);
  });

  it('refuses bad input, secrets and writes without the API header', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    expect(
      (await api.send('POST', 'wiki/pages', { title: 'X', kind: 'planet', text: 'y' })).status,
    ).toBe(400);
    expect((await api.send('POST', 'wiki/forget', {})).status).toBe(400);
    expect((await api.send('POST', 'wiki/pages/nobody/claims', { text: 'x' })).status).toBe(404);
    const secret = await api.send('POST', 'wiki/pages', {
      title: 'Bank',
      kind: 'matter',
      text: 'password: hunter2-very-secret',
    });
    expect(secret.status).toBe(422);
    const forged = await api.send(
      'POST',
      'wiki/pages',
      { title: 'Mina', kind: 'person', text: 'x' },
      {},
    );
    expect(forged.status).toBe(403);
    expect((await api.get('wiki/pages')).body).toEqual({ pages: [] });
    expect((await api.get('nothing/here')).status).toBe(404);
  });

  it('shows and saves the model settings without ever handling the key', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const settings = (await api.get('settings')).body;
    expect(settings.providerTypes).toEqual(expect.arrayContaining(['openai', 'anthropic']));
    expect(settings.stateDir).toBe(harness.stateDir);
    expect(typeof settings.browser.available).toBe('boolean');

    expect((await api.send('PUT', 'settings/provider', { type: 'nope', model: 'm' })).status).toBe(
      400,
    );
    const unset = await api.send('PUT', 'settings/provider', {
      type: 'openai',
      model: 'gpt-x',
      apiKeyEnv: 'NOT_SET_ANYWHERE',
    });
    expect(unset).toEqual({
      status: 400,
      body: { error: 'The provider key variable NOT_SET_ANYWHERE is not set' },
    });
    const saved = await api.send('PUT', 'settings/provider', {
      type: 'openai',
      model: 'gpt-x',
      baseURL: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'SCRIPTED_KEY',
    });
    expect(saved.body).toEqual({ saved: true, restartRequired: true });
    const config = JSON.parse(readFileSync(join(harness.stateDir, 'config.json'), 'utf8'));
    expect(config.provider).toEqual({
      type: 'openai',
      model: 'gpt-x',
      baseURL: 'http://127.0.0.1:1/v1',
      apiKeyEnv: 'SCRIPTED_KEY',
    });
    expect(JSON.stringify(config)).not.toContain('scripted-key');
    expect((await api.get('settings')).body.provider.model).toBe('gpt-x');
  });

  it('keeps ideas by tag and turns one into a goal that remembers where it came from', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const kimchi = (
      await api.send('POST', 'ideas', {
        text: 'Learn to make kimchi. Ask mum for her recipe.',
        tags: ['food'],
      })
    ).body.idea;
    await api.send('POST', 'ideas', { text: 'A picnic at the river', tags: ['outdoors'] });
    expect(kimchi.origin).toBe('owner');
    expect((await api.get('ideas?tag=food')).body.ideas.map((idea: any) => idea.id)).toEqual([
      kimchi.id,
    ]);
    expect((await api.send('POST', 'ideas', { text: 'x', tags: 'food' })).status).toBe(400);
    expect((await api.send('POST', 'ideas', { text: 'x', tags: ['two words'] })).status).toBe(400);

    const made = (await api.send('POST', `ideas/${kimchi.id}/make-goal`)).body;
    expect(made.goal.title).toBe('Learn to make kimchi');
    expect(made.goal.instructions).toBe('Learn to make kimchi. Ask mum for her recipe.');
    expect(made.idea).toEqual(
      expect.objectContaining({ status: 'taken-up', takenUpAs: `goal:${made.goal.id}` }),
    );
    expect((await api.get(`goals/${made.goal.id}`)).body.goal.status).toBe('active');
    // Taking it up again is refused, and no second goal appears.
    expect((await api.send('POST', `ideas/${kimchi.id}/make-goal`)).status).toBe(400);
    expect((await api.get('goals')).body.goals).toHaveLength(1);

    await api.send('POST', `ideas/${kimchi.id}/archive`);
    expect((await api.get('ideas')).body.ideas.map((idea: any) => idea.text)).toEqual([
      'A picnic at the river',
    ]);
    expect((await api.send('POST', `ideas/${kimchi.id}/remove`)).status).toBe(200);
    expect((await api.send('POST', 'ideas/constructor/archive')).status).toBe(404);
  });

  it('pins existing library pages to a space and opens with them', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    await api.send('POST', 'wiki/pages', { title: 'Tomatoes', kind: 'topic', text: 'Stake them' });
    const space = (await api.send('POST', 'spaces', { name: 'Garden' })).body.space;
    expect(space.pinned).toEqual([]);
    const pin = (pageId: string) => api.send('POST', `spaces/${space.id}/pin`, { pageId });
    expect((await pin('nope')).status).toBe(404);
    expect((await pin('../config')).status).toBe(404);
    expect((await api.send('POST', 'spaces/space-none/pin', { pageId: 'tomatoes' })).status).toBe(
      404,
    );
    const pinned = (await pin('tomatoes')).body.space;
    expect(pinned.pinned).toEqual([{ id: 'tomatoes', title: 'Tomatoes' }]);
    expect(pinned.opening).toContain('- Tomatoes (tomatoes)');
    // A forgotten page drops out of the space without unpinning.
    await api.send('POST', 'wiki/forget', { pageId: 'tomatoes' });
    const [after] = (await api.get('spaces')).body.spaces;
    expect(after.pinned).toEqual([]);
    expect(after.opening).toBe('Let\'s work in my space "Garden".');
    const unpinned = await api.send('POST', `spaces/${space.id}/unpin`, { pageId: 'tomatoes' });
    expect(unpinned.body.space.pages).toEqual([]);
  });

  it("shows the agent's browser before it opens a page, and stops it", async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const watch = (await api.get('browser')).body;
    expect(watch).toEqual({ available: expect.any(Boolean), activity: [], held: [] });
    expect((await api.get('browser/screenshot')).body).toEqual({ screenshot: null });
    expect((await api.send('POST', 'browser/stop')).body).toEqual({ stopped: true });
    expect((await api.get('browser')).body.activity[0].action).toBe('stop');
  });

  it('keeps the tab order, refuses what is not a tab, and drops a removed space', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    expect((await api.get('layout')).body).toEqual({ tabs: [] });
    const space = (await api.send('POST', 'spaces', { name: 'Garden' })).body.space;
    const saved = await api.send('POST', 'layout', {
      tabs: [`space:${space.id}`, 'library', 'chat', 'chat'],
    });
    expect(saved.body).toEqual({ tabs: [`space:${space.id}`, 'library', 'chat'] });
    for (const tabs of [['../x'], ['space:nope'], [3], 'chat']) {
      expect((await api.send('POST', 'layout', { tabs })).status).toBe(400);
    }
    expect((await api.get('layout')).body.tabs).toHaveLength(3);
    await api.send('POST', `spaces/${space.id}/remove`);
    expect((await api.get('layout')).body).toEqual({ tabs: ['library', 'chat'] });
  });

  it('records side chats for the menu and forgets them on request', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    expect((await api.get('side-chats')).body).toEqual({ sideChats: [] });
    const recorded = await api.send('POST', 'side-chats', {
      id: 'session-a',
      parentId: 'session-main',
      title: 'Ferry times',
    });
    expect(recorded.body.sideChat).toEqual(
      expect.objectContaining({ id: 'session-a', parentId: 'session-main', title: 'Ferry times' }),
    );
    expect((await api.send('POST', 'side-chats', { id: '../x', title: 't' })).status).toBe(400);
    expect((await api.send('POST', 'side-chats', { title: 't' })).status).toBe(400);
    expect((await api.get('side-chats')).body.sideChats.map((chat: any) => chat.id)).toEqual([
      'session-a',
    ]);
    expect((await api.send('POST', 'side-chats/session-a/remove')).status).toBe(200);
    expect((await api.send('POST', 'side-chats/session-a/remove')).status).toBe(404);
  });

  it('keeps spaces with their opening, edits and removes them', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const api = await client(harness);
    const created = (
      await api.send('POST', 'spaces', { name: 'Jeju trip', instructions: 'Quiet places only.' })
    ).body.space;
    expect(created).toEqual(
      expect.objectContaining({
        name: 'Jeju trip',
        tag: 'jeju-trip',
        opening: 'Let\'s work in my space "Jeju trip".\n\nQuiet places only.',
      }),
    );
    const edited = (
      await api.send('POST', `spaces/${created.id}/update`, {
        name: 'Jeju trip',
        instructions: 'Budget 1M won.',
      })
    ).body.space;
    expect(edited.opening).toContain('Budget 1M won.');
    expect((await api.get('spaces')).body.spaces.map((space: any) => space.name)).toEqual([
      'Jeju trip',
    ]);
    expect((await api.send('POST', 'spaces', { name: ' ' })).status).toBe(400);
    expect((await api.send('POST', 'spaces', { name: 'X', instructions: 3 })).status).toBe(400);
    // The page sends empty instructions for a space without them, and to clear them.
    const plain = await api.send('POST', 'spaces', { name: 'Apartment', instructions: '' });
    expect(plain.status).toBe(200);
    const cleared = await api.send('POST', `spaces/${created.id}/update`, {
      name: 'Jeju trip',
      instructions: '',
    });
    expect(cleared.body.space.opening).toBe('Let\'s work in my space "Jeju trip".');
    expect((await api.send('POST', `spaces/${plain.body.space.id}/remove`)).status).toBe(200);
    expect((await api.send('POST', `spaces/${created.id}/remove`)).status).toBe(200);
    expect((await api.send('POST', 'spaces/constructor/remove')).status).toBe(404);
    expect((await api.get('spaces')).body.spaces).toEqual([]);
  });
});
