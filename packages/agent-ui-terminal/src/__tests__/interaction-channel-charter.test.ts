import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const TUI_CHANNEL_SOURCE = new URL('../TuiInteractionChannel.ts', import.meta.url);
describe('ARCH-018 interaction-channel charter', () => {
  it('does not retain nominal TUI conformance with a no-op write path', () => {
    const source = readFileSync(TUI_CHANNEL_SOURCE, 'utf8');

    expect(source).not.toContain('implements IInteractionChannel');
    expect(source).not.toMatch(/write\(_event:\s*InteractionEvent\)/);
  });
});
