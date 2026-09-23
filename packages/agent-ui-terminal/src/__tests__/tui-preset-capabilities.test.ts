import { describe, expect, it } from 'vitest';

import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';

import type { IRenderOptions } from '../render.js';

function renderOptions(extra: Partial<IRenderOptions> = {}): IRenderOptions {
  return { cwd: '/work', provider: {} as never, ...extra } as IRenderOptions;
}

describe('TUI preset capabilities reach the session', () => {
  it('preserves generation, prompt-seed, and response-format fields', () => {
    const responseFormat = { type: 'json_object' as const };
    const render = renderOptions({
      temperature: 0.37,
      maxOutputTokens: 481,
      presetSystemPrompt: 'Preset seed',
      appendSystemPrompt: 'CLI addition',
      responseFormat,
    });

    const session = buildTuiSessionOptions(toChannelOptions(render));

    expect(session).toMatchObject({
      temperature: 0.37,
      maxOutputTokens: 481,
      presetSystemPrompt: 'Preset seed',
      appendSystemPrompt: 'CLI addition',
      responseFormat,
    });
  });
});
