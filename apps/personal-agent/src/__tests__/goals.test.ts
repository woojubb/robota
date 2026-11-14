import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { findChromiumExecutable } from '../browser/playwright-browser.js';
import { toolResults } from './scripted-model.js';
import { createFixtureWebRoot, startHarness } from './harness.js';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IHarness } from './harness.js';

interface IShop {
  readonly origin: string;
  readonly host: string;
  readonly orders: string[];
  close(): Promise<void>;
}

async function startShop(): Promise<IShop> {
  const orders: string[] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      orders.push(body);
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Done</title><p>Order received: front row</p>');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(
        '<title>Tickets</title><h1>Front row tickets: 40 dollars</h1>' +
          '<form method="post" action="/buy"><label for="qty">Quantity</label><input id="qty" name="qty"><button>Buy</button></form>',
      );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin: `http://${host}`,
    host,
    orders,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

interface IApi {
  get(path: string): Promise<any>;
  post(path: string, body?: unknown): Promise<{ status: number; body: any }>;
}

async function api(harness: IHarness): Promise<IApi> {
  const gui = harness.local.gui!;
  const login = await fetch(new URL('/__monitor_login', gui.url), {
    method: 'POST',
    body: new URLSearchParams({ code: gui.accessCode }),
    redirect: 'manual',
  });
  const base = new URL(`${login.headers.get('location')!}api/`, gui.url);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  return {
    get: async (path) => (await fetch(new URL(path, base), { headers: { cookie } })).json(),
    post: async (path, body) => {
      const response = await fetch(new URL(path, base), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-robota-api': '1' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const pendingApproval = (client: IApi) => async () =>
  ((await client.get('feed')).items as any[]).find((item) => item.approval?.state === 'pending');

let harness: IHarness | undefined;
let shop: IShop | undefined;
afterEach(async () => {
  await harness?.close();
  await shop?.close();
  harness = undefined;
  shop = undefined;
});

describe.skipIf(findChromiumExecutable() === undefined)(
  'goals that run while the person is away',
  () => {
    /** The goal run's script: recall the person's preference, fill the order, and ask to send it. */
    function scriptPurchase(target: IHarness, site: IShop): void {
      target.model.script(
        { tool: 'WikiSearch', args: { query: 'Mina seats' } },
        { tool: 'BrowserOpen', args: { url: `${site.origin}/` } },
        { tool: 'BrowserType', args: { mark: 1, text: '2' } },
        { tool: 'BrowserClick', args: { mark: 2 } },
        {
          tool: 'BrowserSubmit',
          args: { id: 'submission-1', method: 'POST', url: `${site.origin}/buy` },
        },
        (request) => ({ text: `Report: ${toolResults(request).at(-1) ?? ''}` }),
      );
    }

    it('uses what an earlier chat taught, pauses before buying, and buys only once the person approves from the feed', async () => {
      shop = await startShop();
      harness = await startHarness({
        gui: true,
        webRoot: createFixtureWebRoot(),
        browserAllowedHosts: [shop.host],
      });
      harness.model.script(
        {
          tool: 'WikiRemember',
          args: {
            page: 'Mina',
            kind: 'person',
            claim: 'Mina wants front row seats',
            origin: 'owner',
          },
        },
        { text: 'Noted.' },
      );
      await harness.submit('Remember that Mina wants front row seats.');

      const client = await api(harness);
      const created = await client.post('goals', {
        title: 'Concert tickets',
        instructions: 'Buy two tickets for Mina if they cost under 50 dollars.',
      });
      expect(created.status).toBe(200);
      const goalId = created.body.goal.id as string;

      scriptPurchase(harness, shop);
      const runStarted = harness.model.requests.length;
      await client.post(`goals/${goalId}/run`);

      const approval = await until(pendingApproval(client), 'the approval');
      expect(approval.approval).toEqual({
        tool: 'BrowserSubmit',
        detail: `POST ${shop.origin}/buy`,
        state: 'pending',
      });
      expect((await client.get(`goals/${goalId}`)).goal.status).toBe('waiting');
      expect(shop.orders).toEqual([]);
      // The fact came from the wiki, not from the chat's transcript.
      const firstGoalRequest = harness.model.requests[runStarted]!;
      expect(JSON.stringify(firstGoalRequest.messages)).not.toContain('front row');
      expect(toolResults(harness.model.requests[runStarted + 1]!).join(' ')).toContain(
        'Mina wants front row seats',
      );

      expect((await client.post(`feed/${approval.id}/approve`)).status).toBe(200);
      await harness.capabilities.runner()!.settled();
      expect(shop.orders).toEqual(['qty=2']);

      const detail = await client.get(`goals/${goalId}`);
      expect(detail.goal.status).toBe('done');
      const [run] = detail.runs;
      expect(run.outcome).toBe('done');
      expect(run.report).toContain('Order received: front row');
      expect(run.actions.map((action: any) => [action.tool, action.outcome])).toEqual([
        ['WikiSearch', 'done'],
        ['BrowserOpen', 'done'],
        ['BrowserType', 'done'],
        ['BrowserClick', 'done'],
        ['BrowserSubmit', 'waiting-approval'],
        ['BrowserSubmit', 'approved'],
        ['BrowserSubmit', 'done'],
      ]);
      const feed = (await client.get('feed')).items as any[];
      expect(feed[0]).toEqual(expect.objectContaining({ kind: 'report', goalId }));
      expect(feed.find((item) => item.id === approval.id).approval.state).toBe('approved');
    });

    it('sends nothing when the person denies, and still reports', async () => {
      shop = await startShop();
      harness = await startHarness({
        gui: true,
        webRoot: createFixtureWebRoot(),
        browserAllowedHosts: [shop.host],
      });
      const client = await api(harness);
      const goalId = (
        await client.post('goals', { title: 'Concert tickets', instructions: 'Buy two tickets.' })
      ).body.goal.id;
      scriptPurchase(harness, shop);
      await client.post(`goals/${goalId}/run`);
      const approval = await until(pendingApproval(client), 'the approval');
      await client.post(`feed/${approval.id}/deny`);
      await harness.capabilities.runner()!.settled();
      expect(shop.orders).toEqual([]);
      const [run] = (await client.get(`goals/${goalId}`)).runs;
      expect(run.actions.map((action: any) => action.outcome)).toContain('denied');
      expect(run.report).toContain('Report:');
      expect((await client.post(`feed/${approval.id}/approve`)).status).toBe(400);
    });

    it('lets a read-only goal look but not act', async () => {
      shop = await startShop();
      harness = await startHarness({
        gui: true,
        webRoot: createFixtureWebRoot(),
        browserAllowedHosts: [shop.host],
      });
      const client = await api(harness);
      const goalId = (
        await client.post('goals', {
          title: 'Watch prices',
          instructions: 'Check the ticket price.',
          everyMinutes: 60,
          readOnly: true,
        })
      ).body.goal.id;
      harness.model.script(
        { tool: 'BrowserOpen', args: { url: `${shop.origin}/` } },
        { tool: 'BrowserType', args: { mark: 1, text: '2' } },
        (request) => ({
          text: `Price checked. ${toolResults(request).at(-1)?.slice(0, 80) ?? ''}`,
        }),
      );
      await client.post(`goals/${goalId}/run`);
      await harness.capabilities.runner()!.settled();
      const detail = await client.get(`goals/${goalId}`);
      expect(detail.runs[0].actions.map((action: any) => [action.tool, action.outcome])).toEqual([
        ['BrowserOpen', 'done'],
        ['BrowserType', 'denied'],
      ]);
      expect(detail.goal.status).toBe('active');
      expect(detail.goal.nextRunAt > detail.goal.lastRunAt).toBe(true);
      expect(
        (await client.get('feed')).items.some((item: any) => item.approval !== undefined),
      ).toBe(false);
    });
  },
);
