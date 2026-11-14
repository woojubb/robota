import { describe, expect, it } from 'vitest';

import { watchBrowser } from '../browser/watched-browser.js';

import type { IBrowserPort, IBrowserView } from '@robota-sdk/agent-product/personal';

const view: IBrowserView = {
  url: 'https://shop.test/',
  title: 'Concert tickets',
  text: 'Tickets',
  marks: [
    { mark: 1, role: 'textbox', name: 'Card number' },
    { mark: 2, role: 'button', name: 'Buy' },
  ],
};
const held = [
  { id: 'submission-1', method: 'POST', url: 'https://shop.test/buy', fields: ['card'] },
];

function fakePort(): IBrowserPort & { closed: number } {
  const port = {
    closed: 0,
    open: async () => view,
    view: async () => view,
    click: async () => ({ view, held }),
    type: async () => ({ view }),
    submitHeld: async () => ({ view }),
    snapshot: async () => ({ url: view.url, title: view.title, png: new Uint8Array([1, 2]) }),
    close: async () => {
      port.closed += 1;
    },
  };
  return port;
}

describe('the watched browser', () => {
  it('records what the agent did, never what it typed, and what waits for approval', async () => {
    const inner = fakePort();
    let clock = 0;
    const watched = watchBrowser(inner, () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)));
    expect(watched.watch()).toEqual({ activity: [], held: [] });
    await watched.port.open('https://shop.test/');
    await watched.port.type(1, '4111 1111 1111 1111', true);
    await watched.port.click(2);
    const seen = watched.watch();
    expect(seen.page).toEqual({ url: 'https://shop.test/', title: 'Concert tickets' });
    expect(seen.activity.map((entry) => entry.summary)).toEqual([
      'Clicked "Buy" (button)',
      'Typed 19 characters into "Card number" (textbox) and pressed Enter',
      'Opened Concert tickets',
    ]);
    expect(JSON.stringify(seen)).not.toContain('4111');
    expect(seen.held).toEqual(held);
    await watched.port.submitHeld('submission-1', { method: 'POST', url: 'https://shop.test/buy' });
    expect(watched.watch().held).toEqual([]);
    expect(watched.watch().activity[0]!.summary).toBe('Sent POST https://shop.test/buy');
  });

  it('records a failure, passes the snapshot through, and stops by closing the pages', async () => {
    const inner = fakePort();
    inner.open = async () => {
      throw new Error('Refused to open http://10.0.0.1/: private');
    };
    const watched = watchBrowser(inner);
    await expect(watched.port.open('http://10.0.0.1/')).rejects.toThrow('Refused');
    expect(watched.watch().activity[0]).toEqual(
      expect.objectContaining({ action: 'failed', summary: expect.stringContaining('Refused') }),
    );
    expect((await watched.snapshot())?.png).toEqual(new Uint8Array([1, 2]));
    await watched.port.click(2);
    await watched.stop();
    expect(inner.closed).toBe(1);
    expect(watched.watch().page).toBeUndefined();
    expect(watched.watch().held).toEqual([]);
    expect(watched.watch().activity[0]!.action).toBe('stop');
  });
});
