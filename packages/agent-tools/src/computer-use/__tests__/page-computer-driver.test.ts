import { describe, expect, it } from 'vitest';

import { PageComputerDriver } from '../page-computer-driver.js';

import type {
  IBrowserPageAdapter,
  IBrowserPageKeyboardAdapter,
  IBrowserPageMouseAdapter,
} from '../types.js';

/** A recording browser-page double (test-support; duck-types IBrowserPageAdapter — no real SDK). */
class RecordingBrowserPage implements IBrowserPageAdapter {
  readonly calls: string[] = [];
  readonly mouse: IBrowserPageMouseAdapter;
  readonly keyboard: IBrowserPageKeyboardAdapter;

  constructor() {
    this.mouse = {
      click: async (x, y, options) => {
        this.calls.push(
          `click(${x},${y},${options?.button ?? 'left'},${options?.clickCount ?? 1})`,
        );
      },
      move: async (x, y) => {
        this.calls.push(`move(${x},${y})`);
      },
      down: async (options) => {
        this.calls.push(`down(${options?.button ?? 'left'})`);
      },
      up: async (options) => {
        this.calls.push(`up(${options?.button ?? 'left'})`);
      },
      wheel: async (deltaX, deltaY) => {
        this.calls.push(`wheel(${deltaX},${deltaY})`);
      },
    };
    this.keyboard = {
      type: async (text) => {
        this.calls.push(`type(${text})`);
      },
      press: async (key) => {
        this.calls.push(`press(${key})`);
      },
    };
  }

  async screenshot(): Promise<Uint8Array> {
    this.calls.push('screenshot');
    return new Uint8Array([1, 2, 3]);
  }

  async waitForTimeout(ms: number): Promise<void> {
    this.calls.push(`wait(${ms})`);
  }
}

describe('PageComputerDriver', () => {
  // TC-05: the zero-dep reference adapter satisfies IComputerDriver by duck-typing a page — no browser SDK.
  it('drives a duck-typed page and returns base64 screenshots', async () => {
    const page = new RecordingBrowserPage();
    const driver = new PageComputerDriver({ page });

    const perceived = await driver.screenshot();
    expect(perceived?.mediaType).toBe('image/png');
    // base64 of [1,2,3]
    expect(perceived?.data).toBe(Buffer.from([1, 2, 3]).toString('base64'));

    const click = await driver.act({ type: 'click', x: 12, y: 34, button: 'left' });
    expect(page.calls).toContain('click(12,34,left,1)');
    expect(click.screenshot).toBeDefined();

    await driver.act({ type: 'double_click', x: 1, y: 2 });
    expect(page.calls).toContain('click(1,2,left,2)');

    await driver.act({ type: 'type', text: 'hi' });
    expect(page.calls).toContain('type(hi)');

    await driver.act({ type: 'keypress', keys: ['Control', 'a'] });
    expect(page.calls).toContain('press(Control)');
    expect(page.calls).toContain('press(a)');

    await driver.act({ type: 'scroll', x: 5, y: 6, deltaX: 0, deltaY: 100 });
    expect(page.calls).toContain('move(5,6)');
    expect(page.calls).toContain('wheel(0,100)');

    await driver.act({
      type: 'drag',
      path: [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
    });
    expect(page.calls).toContain('down(left)');
    expect(page.calls).toContain('up(left)');

    await driver.act({ type: 'wait', ms: 42 });
    expect(page.calls).toContain('wait(42)');
  });

  it('pauses perception during a takeover and resumes on endTakeover', async () => {
    const page = new RecordingBrowserPage();
    const driver = new PageComputerDriver({ page });

    const takeover = await driver.act({ type: 'takeover', reason: 'password' });
    expect(takeover.takeover).toBe(true);
    expect(takeover.screenshot).toBeUndefined();

    expect(await driver.screenshot()).toBeUndefined();
    const heldAction = await driver.act({ type: 'click', x: 1, y: 1 });
    expect(heldAction.takeover).toBe(true);
    expect(heldAction.screenshot).toBeUndefined();

    await driver.endTakeover();
    expect(await driver.screenshot()).toBeDefined();
  });
});
