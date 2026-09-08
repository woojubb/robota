/**
 * CLI-2004 TC-02 / TC-03 / TC-17 / TC-18 — the mode's entry point.
 *
 * TC-02 asserts BOTH halves of the threading, because they fail independently: Ink's own
 * `isScreenReaderEnabled` option, and the hand-maintained `toChannelOptions` projection that
 * ARCH-110 records as able to drop an option silently.
 * TC-03/TC-18 assert the first line the process prints — the confirmation, the advisory, and the
 * two cases where nothing at all is printed.
 * TC-17 asserts the banner suppression, which TC-11's box-drawing sweep cannot see because the
 * banner is ASCII art, not box-drawing characters.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BANNER_GLYPHS, BANNER_ART } from '../app-banner.js';
import { buildStaticItems } from '../app-static-items.js';
import {
  screenReaderAnnouncement,
  writeScreenReaderAnnouncement,
} from '../screen-reader-announcement.js';
import { toChannelOptions } from '../render.js';

import type { IRenderOptions } from '../render.js';
import type { IHistoryEntry, IAIProvider } from '@robota-sdk/agent-core';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';

const inkRender = vi.hoisted(() =>
  vi.fn((_node: unknown, _options?: { isScreenReaderEnabled?: boolean }) => ({
    waitUntilExit: async (): Promise<void> => {},
  })),
);

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return { ...actual, render: inkRender };
});

// The App boots a channel and starts I/O; the mode's threading is what is under test, not the App.
vi.mock('../App.js', () => ({
  default: (): React.ReactElement => React.createElement('robota-app'),
}));

function baseOptions(): IRenderOptions {
  return {
    cwd: '/tmp/project',
    provider: {} as IAIProvider,
    cliAdapter: {} as ITuiCliAdapter,
  };
}

describe('TC-02: the mode reaches Ink AND the channel projection', () => {
  beforeEach(() => {
    inkRender.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renderApp passes isScreenReaderEnabled: true to Ink render when the mode is on', async () => {
    const { renderApp } = await import('../render.js');
    await renderApp({ ...baseOptions(), screenReader: true });

    expect(inkRender).toHaveBeenCalledTimes(1);
    expect(inkRender.mock.calls[0]?.[1]?.isScreenReaderEnabled).toBe(true);
  });

  it('renderApp passes isScreenReaderEnabled: false when no mode input is present (default-off)', async () => {
    const { renderApp } = await import('../render.js');
    await renderApp(baseOptions());

    expect(inkRender.mock.calls[0]?.[1]?.isScreenReaderEnabled).toBe(false);
  });

  it('toChannelOptions projects screenReader — the ARCH-110 drop hazard', () => {
    expect(toChannelOptions({ ...baseOptions(), screenReader: true }).screenReader).toBe(true);
    expect(toChannelOptions({ ...baseOptions(), screenReader: false }).screenReader).toBe(false);
  });

  it('toChannelOptions leaves screenReader undefined when the option is absent', () => {
    expect(toChannelOptions(baseOptions()).screenReader).toBeUndefined();
  });
});

describe('TC-03: the confirmation line names the channel', () => {
  it('prints the channel that actually turned the mode on', () => {
    expect(screenReaderAnnouncement({ enabled: true, channel: 'flag' })).toBe(
      '[Screen reader mode: on via flag]',
    );
    expect(screenReaderAnnouncement({ enabled: true, channel: 'env' })).toBe(
      '[Screen reader mode: on via env]',
    );
    expect(screenReaderAnnouncement({ enabled: true, channel: 'settings' })).toBe(
      '[Screen reader mode: on via settings]',
    );
  });

  it('prints nothing when the mode is off and no reader hint is present', () => {
    expect(screenReaderAnnouncement({ enabled: false })).toBeUndefined();
    const written: string[] = [];
    writeScreenReaderAnnouncement({ enabled: false }, (text) => written.push(text));
    expect(written).toEqual([]);
  });

  it('renderApp writes the confirmation line to stdout before Ink is called', async () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      });
    inkRender.mockClear();
    inkRender.mockImplementation(() => {
      // Ink is reached only after the line is already on stdout.
      expect(written.join('')).toContain('[Screen reader mode: on via flag]');
      return { waitUntilExit: async (): Promise<void> => {} };
    });
    try {
      const { renderApp } = await import('../render.js');
      await renderApp({ ...baseOptions(), screenReader: true, screenReaderChannel: 'flag' });
    } finally {
      spy.mockRestore();
      inkRender.mockImplementation(() => ({ waitUntilExit: async (): Promise<void> => {} }));
    }
    expect(written.join('')).toContain('[Screen reader mode: on via flag]\n');
    expect(inkRender).toHaveBeenCalledTimes(1);
  });
});

describe('TC-18: the advisory line, and its two negatives', () => {
  it('is the first line when the mode is off and a reader-shaped hint is present', () => {
    const written: string[] = [];
    writeScreenReaderAnnouncement({ enabled: false, hint: true }, (text) => written.push(text));
    expect(written.join('').split('\n')[0]).toBe(
      '[Screen reader mode: off — run with --screen-reader]',
    );
  });

  it('is absent when the mode is off and there is no hint', () => {
    expect(screenReaderAnnouncement({ enabled: false, hint: false })).toBeUndefined();
  });

  it('is replaced by the confirmation line when the mode is on, never printed alongside it', () => {
    const written: string[] = [];
    writeScreenReaderAnnouncement({ enabled: true, channel: 'env', hint: true }, (text) =>
      written.push(text),
    );
    const output = written.join('');
    expect(output).toBe('[Screen reader mode: on via env]\n');
    expect(output).not.toContain('run with --screen-reader');
  });
});

describe('TC-17: the ASCII banner is not committed in the mode', () => {
  const history = [{ id: 'h1' } as unknown as IHistoryEntry];

  it('omits the banner item entirely when the mode is on', () => {
    const items = buildStaticItems({ history, version: '1.2.3', screenReader: true });
    expect(items.some((item) => item.kind === 'banner')).toBe(false);
    expect(items).toEqual([{ kind: 'entry', entry: history[0] }]);
  });

  it('keeps the banner item when the mode is off', () => {
    const items = buildStaticItems({ history, version: '1.2.3', screenReader: false });
    expect(items[0]).toEqual({ kind: 'banner', version: '1.2.3' });
  });

  it('the suppressed art is what carries the glyphs a box-drawing sweep would miss', () => {
    for (const glyph of BANNER_GLYPHS) {
      expect(BANNER_ART).toContain(glyph);
    }
    // None of them is a box-drawing character — hence the separate criterion.
    expect(BANNER_ART).not.toMatch(/[│─┌┐└┘├┤┬┴┼╭╮╰╯]/u);
  });
});
