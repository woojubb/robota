import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { getToolPermissionProfile } from '@robota-sdk/agent-core';

import { offeredTools } from './scripted-model.js';
import { createFixtureWebRoot, startHarness } from './harness.js';

import type { IHarness } from './harness.js';

let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('local mode', () => {
  it('answers a prompt over the HTTP API with the model reply', async () => {
    harness = await startHarness();
    harness.model.script({ text: 'Hello from the personal agent' });
    const result = await harness.submit('Say hello');
    expect(result.status).toBe(200);
    expect(result.events.map((event) => event.event)).toContain('complete');
    expect(result.text).toContain('Hello from the personal agent');
  });

  it('keeps the conversation in the session', async () => {
    harness = await startHarness();
    harness.model.script({ text: 'Remembered reply' });
    await harness.submit('First message');
    const messages = await harness.get('/messages');
    expect(messages.status).toBe(200);
    expect(JSON.stringify(messages.body)).toContain('Remembered reply');
  });

  it('never offers the model a tool that runs commands, nor peer file sending', async () => {
    harness = await startHarness();
    harness.model.script({ text: 'ok' });
    await harness.submit('What can you do?');
    const tools = offeredTools(harness.model.requests[0]!);
    const executing = tools.filter(
      (name) => getToolPermissionProfile(name).riskClass === 'execute',
    );
    expect(executing).toEqual([]);
    expect(tools).not.toContain('peer_send_file');
    expect(tools).toContain('WebFetch');
  });

  it('names a chat with the rename command and offers no session command that leaves its bounds', async () => {
    harness = await startHarness();
    const command = (name: string, args: string) =>
      fetch(`${harness!.local.httpUrl}/command`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${harness!.local.httpToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name, args }),
      });
    const renamed = await command('rename', 'Jeju trip');
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual(expect.objectContaining({ success: true }));
    for (const name of ['cd', 'resume', 'clear']) {
      expect((await command(name, '..')).status).toBe(404);
    }
  });

  it('shows the model the personal instructions', async () => {
    harness = await startHarness();
    harness.model.script({ text: 'ok' });
    await harness.submit('hi');
    const system = harness.model.requests[0]!.messages.find((message) => message.role === 'system');
    expect(String(system?.content)).toContain('personal assistant');
  });

  it('refuses an HTTP request without the bearer', async () => {
    harness = await startHarness();
    const res = await fetch(`${harness.local.httpUrl}/executing`);
    expect(res.status).toBe(401);
  });

  it('admits a WebSocket client only with the launch token', async () => {
    harness = await startHarness();
    const url = new URL(harness.local.wsUrl);
    const withToken = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(url.toString());
      socket.once('open', () => {
        socket.close();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.once('close', (code) => {
        if (code !== 1000 && code !== 1005) resolve(false);
      });
    });
    expect(withToken).toBe(true);
    url.searchParams.set('token', 'wrong-token');
    const withoutToken = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(url.toString());
      socket.once('message', () => resolve(true));
      socket.once('error', () => resolve(false));
      socket.once('close', () => resolve(false));
    });
    expect(withoutToken).toBe(false);
  });
});

describe('web GUI server', () => {
  it('serves the GUI only after the access code, with the WebSocket URL injected', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const gui = harness.local.gui!;
    const form = await fetch(gui.url);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain('Access code');

    const wrong = await fetch(new URL('/__monitor_login', gui.url), {
      method: 'POST',
      body: new URLSearchParams({ code: 'not-the-code' }),
      redirect: 'manual',
    });
    expect(wrong.status).toBe(403);

    const login = await fetch(new URL('/__monitor_login', gui.url), {
      method: 'POST',
      body: new URLSearchParams({ code: gui.accessCode }),
      redirect: 'manual',
    });
    expect(login.status).toBe(303);
    const location = login.headers.get('location')!;
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;

    const withoutCookie = await fetch(new URL(location, gui.url));
    expect(withoutCookie.status).toBe(403);

    const page = await fetch(new URL(location, gui.url), { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(
      `<meta name="ws-url" content="${harness.local.wsUrl.replaceAll('"', '&quot;')}"`,
    );

    const asset = await fetch(new URL(`${location}assets/app.js`, gui.url), {
      headers: { cookie },
    });
    expect(asset.status).toBe(200);

    const traversal = await fetch(new URL(`${location}..%2F..%2Fpackage.json`, gui.url), {
      headers: { cookie },
    });
    expect(traversal.status).toBe(403);
  });

  it('serves the web UI on the fixed port it is given, so an address registered in advance stays valid', async () => {
    const { createServer } = await import('node:http');
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
    const port = (probe.address() as import('node:net').AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot(), guiPort: port });
    expect(new URL(harness.local.gui!.url).port).toBe(String(port));
    expect((await fetch(harness.local.gui!.url)).status).toBe(200);
  });

  it('refuses a request whose Host is not loopback', async () => {
    harness = await startHarness({ gui: true, webRoot: createFixtureWebRoot() });
    const { request } = await import('node:http');
    const url = new URL(harness.local.gui!.url);
    const status = await new Promise<number>((resolve) => {
      const req = request(
        { host: url.hostname, port: url.port, path: '/', headers: { host: 'evil.example' } },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe('local mode start and stop', () => {
  it('releases what it started when the WebSocket port is taken, so the next start on the same state works', async () => {
    const { createServer } = await import('node:http');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { startLocalMode } = await import('../local-mode.js');
    const { startScriptedModel } = await import('./scripted-model.js');
    const { createProviderFromProfile } = await import('../provider.js');
    const stateDir = mkdtempSync(join(tmpdir(), 'personal-agent-start-'));
    const model = await startScriptedModel();
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', () => resolve()));
    const takenPort = (busy.address() as import('node:net').AddressInfo).port;
    const provider = () =>
      createProviderFromProfile(
        { type: 'openai', model: 'scripted-model', baseURL: model.baseURL, apiKeyEnv: 'KEY' },
        { KEY: 'k' },
      );
    try {
      await expect(
        startLocalMode({ stateDir, provider: provider(), gui: false, wsPort: takenPort }),
      ).rejects.toThrow();
      const local = await startLocalMode({ stateDir, provider: provider(), gui: false });
      await local.stop();
    } finally {
      await new Promise<void>((resolve) => busy.close(() => resolve()));
      await model.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
