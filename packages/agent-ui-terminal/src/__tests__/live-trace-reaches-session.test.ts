import { describe, expect, it, vi } from 'vitest';
import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import type { IRenderOptions } from '../render.js';

const testHost = createTestFrameworkHost();

describe('live trace port projection', () => {
  it('passes the exact host port through the TUI to the runtime session', () => {
    const livePromptTrace = { enqueue: vi.fn() };
    const render = { host: testHost, cwd: '/w', provider: {} as never, cliAdapter: {} as never, livePromptTrace } as IRenderOptions;
    const channel = toChannelOptions(render);
    expect(channel.livePromptTrace).toBe(livePromptTrace);
    expect(buildTuiSessionOptions(channel).livePromptTrace).toBe(livePromptTrace);
  });
});
