import { describe, expect, it } from 'vitest';

import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';

import type { IRenderOptions } from '../render.js';
import type { ITuiInteractionChannelOptions } from '../TuiInteractionChannel.js';
import type { IOutputStylePrompt } from '@robota-sdk/agent-framework';

const STYLE: IOutputStylePrompt = {
  id: 'concise',
  name: 'Concise',
  instructions: 'Lead with the answer.',
  keepCodingInstructions: true,
  tokenCost: 'low',
};

const renderOptions = (over: Partial<IRenderOptions> = {}): IRenderOptions =>
  ({ cwd: '/w', provider: {}, ...over }) as IRenderOptions;

describe('CLI-1988 output-style projection', () => {
  it('preserves the resolved style from render options through the TUI session options', () => {
    const channel = toChannelOptions(renderOptions({ outputStyle: STYLE }));
    expect(channel.outputStyle).toBe(STYLE);

    const session = buildTuiSessionOptions(channel as ITuiInteractionChannelOptions);
    expect(session).toHaveProperty('outputStyle', STYLE);
  });

  it('omits the style when no startup selection was supplied', () => {
    expect(
      'outputStyle' in buildTuiSessionOptions(renderOptions() as ITuiInteractionChannelOptions),
    ).toBe(false);
  });
});
