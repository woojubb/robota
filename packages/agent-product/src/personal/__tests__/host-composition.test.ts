import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluatePermission } from '@robota-sdk/agent-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BROWSER_TOOL_NAMES,
  GOAL_TOOL_NAMES,
  GoalBook,
  KnowledgeWiki,
  WIKI_TOOL_NAMES,
  createBrowserTools,
  createGoalTools,
  createMemoryGoalStore,
  createMemoryKnowledgeStore,
  createWikiTools,
} from '../index.js';

import type { IBrowserActionResult, IBrowserPort, IBrowserView } from '../index.js';

const page: IBrowserView = {
  url: 'https://shop.example/',
  title: 'Tickets',
  text: 'Two tickets left.',
  marks: [{ mark: 1, role: 'button', name: 'Buy' }],
};

/** A browser that exists only in memory: it holds each submission and records what is sent. */
function memoryBrowser(): IBrowserPort & { sent: string[] } {
  const sent: string[] = [];
  const hold = (id: string): IBrowserActionResult => ({
    view: page,
    held: [{ id, method: 'POST', url: `https://shop.example/${id}`, fields: ['qty'] }],
  });
  let clicks = 0;
  return {
    sent,
    open: async () => page,
    view: async () => page,
    click: async () => hold(`buy-${(clicks += 1)}`),
    type: async () => ({ view: page }),
    submitHeld: async (id, expected) => {
      sent.push(`${id} ${expected.method} ${expected.url}`);
      return { view: { ...page, text: 'Order received' } };
    },
    close: async () => undefined,
  };
}

let home: string;
let previousHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'host-composition-home-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = home;
});
afterEach(() => {
  if (previousHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('a host made only of in-memory adapters', () => {
  it('runs the product steps behind a host made only of in-memory adapters', async () => {
    const wiki = new KnowledgeWiki({ store: createMemoryKnowledgeStore() });
    const goals = new GoalBook({ store: createMemoryGoalStore() });
    const browser = memoryBrowser();
    const tools = new Map(
      [...createWikiTools(wiki), ...createGoalTools(goals), ...createBrowserTools(browser)].map(
        (tool) => [tool.schema.name, tool],
      ),
    );
    const call = async (
      name: string,
      args: Record<string, string | number | boolean>,
    ): Promise<string> => {
      const result = await tools.get(name)!.execute(args, { toolName: name, parameters: {} });
      const data = (result as { data?: unknown }).data;
      return typeof data === 'string' ? data : JSON.stringify(data);
    };
    /** What a host does with a call that needs a person: it waits on a card in the feed. */
    const gate = async (
      name: string,
      args: Record<string, string | number | boolean>,
    ): Promise<string> => {
      // The app runs turns in `acceptEdits`; a held submission still needs a person in every mode that
      // would let an ordinary edit through, while clicking inside the browser does not.
      for (const mode of ['acceptEdits', 'auto', 'bypassPermissions'] as const) {
        expect(evaluatePermission(name, args, mode, { allow: [name] }), mode).toBe('approve');
        expect(evaluatePermission(BROWSER_TOOL_NAMES.click, { mark: 1 }, mode, {}), mode).toBe(
          'auto',
        );
      }
      const card = await goals.post({
        kind: 'approval',
        title: name,
        body: JSON.stringify(args),
        approval: { tool: name, detail: JSON.stringify(args), state: 'pending' },
      });
      return card.id;
    };
    const decide = async (cardId: string, approved: boolean): Promise<void> => {
      const card = await goals.setApproval(cardId, approved ? 'approved' : 'denied');
      if (card.approval!.state === 'approved')
        await call(card.approval!.tool, JSON.parse(card.approval!.detail));
    };

    // A fact is filed and found again.
    await call(WIKI_TOOL_NAMES.remember, {
      page: 'Mina',
      kind: 'person',
      claim: 'Mina is allergic to peanuts',
      origin: 'owner',
    });
    expect(await call(WIKI_TOOL_NAMES.search, { query: 'peanuts' })).toContain('allergic');

    // A goal is created and listed.
    expect(
      await call(GOAL_TOOL_NAMES.create, { title: 'Tickets', instructions: 'Watch the shop' }),
    ).toContain('created');
    expect(await call(GOAL_TOOL_NAMES.list, {})).toContain('Tickets');

    // A submission is held and nothing is sent until a person approves it.
    const first = await call(BROWSER_TOOL_NAMES.click, { mark: 1 });
    expect(first).toContain('HELD buy-1');
    expect(browser.sent).toEqual([]);
    const firstCard = await gate(BROWSER_TOOL_NAMES.submit, {
      id: 'buy-1',
      method: 'POST',
      url: 'https://shop.example/buy-1',
    });
    expect(browser.sent).toEqual([]);
    await decide(firstCard, true);
    expect(browser.sent).toEqual(['buy-1 POST https://shop.example/buy-1']);

    // A second one is denied: nothing more is sent.
    await call(BROWSER_TOOL_NAMES.click, { mark: 1 });
    const secondCard = await gate(BROWSER_TOOL_NAMES.submit, {
      id: 'buy-2',
      method: 'POST',
      url: 'https://shop.example/buy-2',
    });
    await decide(secondCard, false);
    expect(browser.sent).toEqual(['buy-1 POST https://shop.example/buy-1']);
    expect((await goals.feedItem(secondCard))?.approval?.state).toBe('denied');

    // Nothing reached the disk of the machine the test ran on.
    expect(readdirSync(home)).toEqual([]);
  });
});
