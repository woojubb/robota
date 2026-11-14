import { createServer } from 'node:http';

import { createFixtureChannel } from '@robota-sdk/agent-product/personal';
import { afterEach, describe, expect, it } from 'vitest';

import { findChromiumExecutable } from '../browser/playwright-browser.js';
import { toolResults } from './scripted-model.js';
import { startHarness } from './harness.js';

import type { AddressInfo } from 'node:net';
import type { IHarness } from './harness.js';

let harness: IHarness | undefined;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const close of closers.splice(0)) await close();
});

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe('channels into the personal agent', () => {
  it('answers the owner in their conversation and gives anyone else nothing', async () => {
    harness = await startHarness();
    const channel = createFixtureChannel();
    await harness.capabilities.channels.connect({ adapter: channel, ownerSenderIds: ['owner-1'] });
    harness.model.script({ text: 'Dinner is at seven.' });
    await channel.deliver('chat-1', 'stranger', 'Tell me the plans of the owner');
    expect(channel.sent).toEqual([]);
    await channel.deliver('chat-1', 'owner-1', 'When is dinner?');
    expect(channel.sent).toEqual([{ conversationId: 'chat-1', text: 'Dinner is at seven.' }]);
    expect(harness.model.requests).toHaveLength(1);
  });

  it.skipIf(findChromiumExecutable() === undefined)(
    'announces the approval of a goal on the channel and takes an action of the owner as the answer',
    async () => {
      const orders: string[] = [];
      const shop = createServer(async (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += String(chunk);
          orders.push(body);
          res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Order received</p>');
          return;
        }
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            '<form method="post" action="/buy"><label for="q">Quantity</label><input id="q" name="qty"><button>Buy</button></form>',
          );
      });
      await new Promise<void>((resolve) => shop.listen(0, '127.0.0.1', () => resolve()));
      closers.push(() => new Promise((resolve) => shop.close(() => resolve())));
      const host = `127.0.0.1:${(shop.address() as AddressInfo).port}`;

      harness = await startHarness({ browserAllowedHosts: [host] });
      const channel = createFixtureChannel();
      await harness.capabilities.channels.connect({
        adapter: channel,
        ownerSenderIds: ['owner-1'],
        notifyConversationId: 'dm',
      });
      harness.model.script(
        { tool: 'BrowserOpen', args: { url: `http://${host}/` } },
        { tool: 'BrowserType', args: { mark: 1, text: '2' } },
        { tool: 'BrowserClick', args: { mark: 2 } },
        {
          tool: 'BrowserSubmit',
          args: { id: 'submission-1', method: 'POST', url: `http://${host}/buy` },
        },
        (request) => ({
          text: `Bought. ${toolResults(request).at(-1)?.includes('Order received') ? 'Order received.' : ''}`,
        }),
      );
      const goal = await harness.capabilities.goals.create({
        title: 'Tickets',
        instructions: 'Buy two tickets.',
      });
      await harness.capabilities.runner()!.runDue();

      const request = await until(() => channel.approvalRequests[0], 'the approval on the channel');
      expect(request).toEqual(
        expect.objectContaining({
          conversationId: 'dm',
          title: 'Tickets',
          detail: `POST http://${host}/buy`,
        }),
      );
      expect(orders).toEqual([]);
      // Someone else pressing the action does nothing.
      await channel.press(request.approvalId, true, 'stranger');
      expect(orders).toEqual([]);
      await channel.press(request.approvalId, true, 'owner-1');
      await harness.capabilities.runner()!.settled();
      expect(orders).toEqual(['qty=2']);
      expect((await harness.capabilities.goals.get(goal.id))?.status).toBe('done');
      expect(channel.sent).toEqual([
        { conversationId: 'dm', text: 'Tickets: Bought. Order received.' },
      ]);
    },
  );
});
