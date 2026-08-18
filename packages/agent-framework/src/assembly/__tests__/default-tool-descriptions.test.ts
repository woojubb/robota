import { describe, expect, it } from 'vitest';

import { DEFAULT_TOOL_DESCRIPTIONS } from '../create-session-runtime.js';

/**
 * ARCH-035 SPLIT this file rather than moving it. The tool-assembly cases went to
 * `@robota-sdk/agent-tool-defaults` with the aggregator; these two stayed, because
 * `DEFAULT_TOOL_DESCRIPTIONS` stayed — its only consumer builds the system prompt synchronously.
 *
 * What these cases do NOT check, stated because the gap is the point: nothing here ties a description
 * to a tool that is actually assembled. The list is hard-coded and the coupling is now cross-package.
 * Filed separately; asserting it here would be asserting the defect.
 */
describe('DEFAULT_TOOL_DESCRIPTIONS', () => {
  it('describes the web tools as local tools, which is how the prompt presents them', () => {
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain('WebFetch — fetch URL content as text');
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain(
      'WebSearch — search the internet through the configured local tool',
    );
  });
});
