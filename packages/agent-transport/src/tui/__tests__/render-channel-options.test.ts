import { describe, it, expect } from 'vitest';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import { toChannelOptions } from '../render.js';
import type { IRenderOptions } from '../render.js';

describe('toChannelOptions', () => {
  it('TC-02: threads allowedTools and deniedTools into the channel options', () => {
    const renderOptions: IRenderOptions = {
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      allowedTools: ['Read'],
      deniedTools: ['Bash'],
    };
    const channelOptions = toChannelOptions(renderOptions, 'session-1');
    expect(channelOptions.allowedTools).toEqual(['Read']);
    expect(channelOptions.deniedTools).toEqual(['Bash']);
    expect(channelOptions.resumeSessionId).toBe('session-1');
    expect(channelOptions.cwd).toBe('/tmp/project');
  });

  it('leaves tool filters undefined when not provided', () => {
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
    });
    expect(channelOptions.allowedTools).toBeUndefined();
    expect(channelOptions.deniedTools).toBeUndefined();
  });
});
