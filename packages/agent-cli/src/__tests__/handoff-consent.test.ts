import type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';
import type { IPeerAdmission } from '@robota-sdk/agent-interface-transport';
import { describe, expect, it, vi } from 'vitest';

import { createHandoffConsent } from '../handoff/handoff-consent.js';

/**
 * SEC-011 (issue #1865) — the consent prompt at the DESTINATION.
 *
 * There is exactly one way to return true, and it needs a person to have chosen it. Every case here
 * is one of the ways that does NOT happen, because those are the ones that decide whether the step
 * is a control or a formality.
 */

const ADMISSION: IPeerAdmission = {
  admitted: true,
  trust: 'same-user-different-host',
  origin: { sessionId: 'desktop-session-1' },
};

function harness(answer?: TActionResponse, renderer = true) {
  const asked: IActionRequest[] = [];
  const consent = createHandoffConsent({
    getUserInteraction: () =>
      renderer
        ? {
            ask: async (request: IActionRequest) => {
              asked.push(request);
              return answer ?? { type: 'answer', values: ['accept'] };
            },
          }
        : undefined,
    deviceLabel: 'this laptop',
  });
  return { asked, consent };
}

describe('there is one way to say yes', () => {
  it('accepts when the person chooses to accept', async () => {
    const { consent } = harness({ type: 'answer', values: ['accept'] });
    expect(await consent(ADMISSION)).toBe(true);
  });

  it.each([
    ['the person declines', { type: 'answer', values: ['decline'] } as TActionResponse],
    ['the prompt is dismissed', { type: 'cancelled' } as TActionResponse],
    ['the answer is empty', { type: 'answer', values: [] } as TActionResponse],
    [
      'an option nobody offered comes back',
      { type: 'answer', values: ['maybe'] } as TActionResponse,
    ],
  ])('refuses when %s', async (_label, answer) => {
    const { consent } = harness(answer);
    expect(await consent(ADMISSION)).toBe(false);
  });

  it('refuses when no renderer is attached, without waiting for one', async () => {
    // A session that started running here because nobody was present to decline it is the failure
    // this step exists to prevent.
    const { consent, asked } = harness(undefined, false);
    expect(await consent(ADMISSION)).toBe(false);
    expect(asked).toHaveLength(0);
  });

  it('reads the renderer at ASK time, not when it was configured', async () => {
    // A session can lose its renderer between being configured and a transfer arriving. A captured
    // port would prompt into nothing and wait forever — a hang rather than a refusal.
    let attached = true;
    const consent = createHandoffConsent({
      getUserInteraction: () =>
        attached ? { ask: async () => ({ type: 'answer', values: ['accept'] }) } : undefined,
      deviceLabel: 'this laptop',
    });
    expect(await consent(ADMISSION)).toBe(true);
    attached = false;
    expect(await consent(ADMISSION)).toBe(false);
  });
});

describe('what the prompt tells the person', () => {
  it('names the proven origin and this machine', async () => {
    const { consent, asked } = harness();
    await consent(ADMISSION);

    expect(asked[0]?.title).toContain('desktop-session-1');
    expect(asked[0]?.title).toContain('this laptop');
  });

  it('says what taking the session means HERE, not just that a transfer is offered', async () => {
    // The destination is not being asked the source's question. It is being asked whether to run
    // someone else's work with this machine's credential, files and shell.
    const { consent, asked } = harness();
    await consent(ADMISSION);

    const description = asked[0]?.description ?? '';
    expect(description).toContain("THIS machine's provider credential");
    expect(description).toContain('its files, its shell');
    expect(description).toContain('read-only');
  });

  it('falls back to a neutral name rather than inventing one when the origin is absent', async () => {
    const { consent, asked } = harness();
    await consent({ admitted: true, trust: 'same-user-different-host' });

    expect(asked[0]?.title).toContain('another device');
    expect(asked[0]?.title).not.toContain('undefined');
  });
});
