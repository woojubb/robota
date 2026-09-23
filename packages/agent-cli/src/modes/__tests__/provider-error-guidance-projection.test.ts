import { describe, expect, it } from 'vitest';

import { buildServeSessionOptions } from '../serve-mode.js';

describe('serve and MCP provider recovery guidance', () => {
  it('preserves the product guidance in the session options both modes use', () => {
    const providerErrorGuidance = { authentication: 'Configure product A.' };
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
      providerErrorGuidance,
    } as never);

    expect(options.providerErrorGuidance).toBe(providerErrorGuidance);
  });
});
