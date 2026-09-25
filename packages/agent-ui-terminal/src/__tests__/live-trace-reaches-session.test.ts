import { describe, expect, it, vi } from 'vitest';
import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';
import type { IRenderOptions } from '../render.js';

describe('live trace port projection', () => {
  it('passes the exact host port through the TUI to the runtime session', () => {
    const livePromptTrace = { enqueue: vi.fn() };
    const render = { cwd: '/w', provider: {} as never, cliAdapter: {} as never, livePromptTrace } as IRenderOptions;
    const channel = toChannelOptions(render);
    expect(channel.livePromptTrace).toBe(livePromptTrace);
    expect(buildTuiSessionOptions(channel).livePromptTrace).toBe(livePromptTrace);
  });
});
