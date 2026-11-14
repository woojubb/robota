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
});
