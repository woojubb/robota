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

  it('CLI-076: threads the display modelId into the channel model override', () => {
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      modelId: 'claude-haiku-4-5-20251001',
    });
    // The status-line model id IS the session's model override (header == the model actually called).
    expect(channelOptions.model).toBe('claude-haiku-4-5-20251001');
  });

  it('CLI-076: leaves model undefined when no modelId is resolved', () => {
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
    });
    expect(channelOptions.model).toBeUndefined();
  });
});
