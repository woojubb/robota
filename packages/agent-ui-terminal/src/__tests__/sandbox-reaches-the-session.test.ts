/**
 * Issue #3242: the TUI session consults the same sandbox the shell tools run under, so a confined
 * command the sandbox approves runs without a prompt.
 */

import { describe, expect, it } from 'vitest';

import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';

import type { IRenderOptions } from '../render.js';

type TSandboxClient = NonNullable<IRenderOptions['sandboxClient']>;

const sandboxClient = { filesystem: 'shared', autoApproves: () => true } as unknown as TSandboxClient;

function renderOptions(extra: Partial<IRenderOptions> = {}): IRenderOptions {
  return { cwd: '/work', provider: {} as never, ...extra } as IRenderOptions;
}

describe('the TUI projection carries the sandbox client', () => {
  it('passes the supplied sandbox through the channel into the session', () => {
    const channel = toChannelOptions(renderOptions({ sandboxClient }));

    expect((buildTuiSessionOptions(channel) as { sandboxClient?: unknown }).sandboxClient).toBe(
      sandboxClient,
    );
  });

  it('carries none when none was supplied', () => {
    const channel = toChannelOptions(renderOptions());

    expect(
      (buildTuiSessionOptions(channel) as { sandboxClient?: unknown }).sandboxClient,
    ).toBeUndefined();
  });
});
