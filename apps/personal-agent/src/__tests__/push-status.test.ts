import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPushApi } from '../push/push-api.js';
import { createPushSubscriptions } from '../push/subscriptions.js';
import { createVapid } from '../push/vapid.js';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('push status and stale subscriptions', () => {
  it('checks the browser actually held by the agent and clears all saved browsers', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'push-status-'));
    paths.push(directory);
    const subscriptions = createPushSubscriptions({ directory, admit: async () => undefined });
    const api = createPushApi({ subscriptions, vapid: createVapid(directory) });
    const key = createECDH('prime256v1');
    key.generateKeys();
    const endpoint = 'https://push.example.test/a';
    await subscriptions.add({
      endpoint,
      keys: {
        p256dh: key.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    });
    const call = (method: string, part: string, body?: unknown) =>
      api({
        method,
        path: `/push/${part}`,
        segments: ['push', part],
        query: new URLSearchParams(),
        body,
      });
    expect((await call('POST', 'status', { endpoint }))?.body).toEqual({
      subscribed: 1,
      supported: true,
      current: true,
    });
    expect(
      (await call('POST', 'status', { endpoint: 'https://push.example.test/other' }))?.body,
    ).toEqual({ subscribed: 1, supported: true, current: false });
    expect((await call('DELETE', 'subscriptions'))?.body).toEqual({
      subscribed: 0,
      supported: true,
    });
    expect(subscriptions.count()).toBe(0);
  });

  it('replaces an older subscription before enforcing the browser limit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'push-replace-'));
    paths.push(directory);
    const subscriptions = createPushSubscriptions({
      directory,
      admit: async (url) => (url.pathname === '/refused' ? 'refused' : undefined),
    });
    const api = createPushApi({ subscriptions, vapid: createVapid(directory) });
    const key = createECDH('prime256v1');
    key.generateKeys();
    const keys = {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    };
    const endpoint = (name: string) => `https://push.example.test/${name}`;
    for (const name of ['first', 'second', 'third', 'fourth', 'legacy'])
      await subscriptions.add({ endpoint: endpoint(name), keys });

    const request = (body: unknown) =>
      api({
        method: 'POST',
        path: '/push/subscribe',
        segments: ['push', 'subscribe'],
        query: new URLSearchParams(),
        body,
      });
    await expect(
      request({ endpoint: endpoint('refused'), keys, replacing: [endpoint('legacy')] }),
    ).rejects.toThrow('refused');
    expect(subscriptions.list().map((entry) => entry.endpoint)).toEqual(
      ['first', 'second', 'third', 'fourth', 'legacy'].map(endpoint),
    );
    expect(
      (await request({ endpoint: endpoint('new'), keys, replacing: [endpoint('legacy')] }))?.body,
    ).toEqual({ subscribed: 5, supported: true });
    expect(subscriptions.list().map((entry) => entry.endpoint)).toEqual(
      ['first', 'second', 'third', 'fourth', 'new'].map(endpoint),
    );
  });
});
