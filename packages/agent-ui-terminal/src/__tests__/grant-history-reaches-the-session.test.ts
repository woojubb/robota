/**
 * #3189 — the run's external-event grant history reaches every session the TUI builds. It is created
 * once per run so a session switch replays no spent token and resets no rate; dropped on the way
 * (the render projection copies field by field, and a spread skips the excess-property check), each
 * session would open its grants with an empty history.
 */

import { createExternalEventGrantHistory } from '@robota-sdk/agent-framework';
import { describe, expect, it } from 'vitest';

import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';

import type { IRenderOptions } from '../render.js';

describe('#3189: the grant history survives the TUI projection', () => {
  it('carries the same history instance into every session it builds', () => {
    const history = createExternalEventGrantHistory();
    const options = {
      cwd: '/work',
      provider: {} as never,
      externalEventGrantHistory: history,
    } as unknown as IRenderOptions;

    const first = buildTuiSessionOptions(toChannelOptions(options, undefined));
    const switchedTo = buildTuiSessionOptions(toChannelOptions(options, 'session-b'));

    expect(first.externalEventGrantHistory).toBe(history);
    expect(switchedTo.externalEventGrantHistory).toBe(history);
  });
});
