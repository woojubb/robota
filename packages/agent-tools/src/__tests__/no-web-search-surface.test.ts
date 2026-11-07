import { describe, expect, it } from 'vitest';

import * as agentTools from '../index.js';
import * as nodeEntry from '../node.js';

/**
 * Web search reaches the model through the provider's native search and through MCP servers, never
 * through a tool, port or vendor adapter in this neutral package.
 */
describe('agent-tools has no web search surface', () => {
  it.each([
    ['main entry', agentTools],
    ['node entry', nodeEntry],
  ])('the %s exports no web-search or search-vendor symbol', (_label, entry) => {
    const offending = Object.keys(entry).filter((name) => /web-?search|brave/i.test(name));
    expect(offending).toEqual([]);
  });
});
