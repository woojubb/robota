import { describe, expect, it, vi } from 'vitest';

import { createUserInteractionPort } from './user-interaction-port.js';

import type { TCommandInvocationSource } from '../command-api/host-context.js';
import type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';

const request: IActionRequest = { id: 'q', title: 'Pick' };
const answer: TActionResponse = { type: 'answer', values: ['x'] };

describe('createUserInteractionPort (CMD-004 ask seam)', () => {
  it('returns undefined when no ask handler is attached (no interactive renderer)', () => {
    expect(createUserInteractionPort(undefined, () => 'user')).toBeUndefined();
  });

  it('delegates to the handler for user-invoked commands', async () => {
    const handler = vi.fn(async () => answer);
    const port = createUserInteractionPort(handler, () => 'user');
    if (!port) throw new Error('expected a port');
    const res = await port.ask(request);
    expect(handler).toHaveBeenCalledWith(request);
    expect(res).toEqual(answer);
  });

  it('resolves cancelled WITHOUT calling the handler for model-invoked commands (TC-07 deadlock guard)', async () => {
    const handler = vi.fn(async () => answer);
    const port = createUserInteractionPort(handler, () => 'model');
    if (!port) throw new Error('expected a port');
    const res = await port.ask(request);
    expect(res).toEqual({ type: 'cancelled' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('re-reads the invocation source on each ask (not captured once)', async () => {
    const handler = vi.fn(async () => answer);
    let source: TCommandInvocationSource = 'user';
    const port = createUserInteractionPort(handler, () => source);
    if (!port) throw new Error('expected a port');
    expect((await port.ask(request)).type).toBe('answer');
    source = 'model';
    expect((await port.ask(request)).type).toBe('cancelled');
  });
});
