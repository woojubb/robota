/**
 * CMD-004 PR-E: ProgrammaticInteractionChannel.askUser() — the unified ask path on the programmatic
 * channel. FIFO from the pre-supplied queue; empty queue → cancelled (never blocks a headless run).
 */
import { describe, expect, it } from 'vitest';

import { ProgrammaticInteractionChannel } from '../../programmatic/ProgrammaticInteractionChannel.js';

import type { IActionRequest } from '@robota-sdk/agent-core';

const REQUEST: IActionRequest = {
  id: 'q',
  title: 'Pick',
  options: [{ value: 'a', label: 'A' }],
  maxSelect: 1,
};

describe('ProgrammaticInteractionChannel.askUser', () => {
  it('resolves cancelled when no answer is queued', async () => {
    const channel = new ProgrammaticInteractionChannel();
    expect(await channel.askUser(REQUEST)).toEqual({ type: 'cancelled' });
  });

  it('resolves queued answers FIFO, then cancelled once drained', async () => {
    const channel = new ProgrammaticInteractionChannel();
    channel.queueUserAction({ type: 'answer', values: ['a'] });
    channel.queueUserAction({ type: 'cancelled' });
    expect(await channel.askUser(REQUEST)).toEqual({ type: 'answer', values: ['a'] });
    expect(await channel.askUser(REQUEST)).toEqual({ type: 'cancelled' });
    expect(await channel.askUser(REQUEST)).toEqual({ type: 'cancelled' });
  });

  it('keeps the legacy requestAction queue independent of the ask queue', async () => {
    const channel = new ProgrammaticInteractionChannel();
    channel.queueUserAction({ type: 'answer', values: ['a'] });
    // legacy requestAction has its own (empty) queue → cancelled, unaffected by queueUserAction
    expect(await channel.requestAction({ type: 'confirm', id: 'x', message: 'ok?' })).toEqual({
      type: 'cancelled',
    });
    expect(await channel.askUser(REQUEST)).toEqual({ type: 'answer', values: ['a'] });
  });
});
