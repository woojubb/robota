import { describe, expect, it } from 'vitest';

import { mcpServeProtocolArgs } from '../mcp-serve-invocation.js';

describe('mcpServeProtocolArgs', () => {
  it('recognizes a test-product mcp serve run, which speaks MCP on stdout', () => {
    expect(mcpServeProtocolArgs(['mcp', 'serve'])?.positional).toEqual(['mcp', 'serve']);
  });

  it('is undefined for a help request, whose text must reach stdout', () => {
    expect(mcpServeProtocolArgs(['mcp', 'serve', '--help'])).toBeUndefined();
    expect(mcpServeProtocolArgs(['mcp', 'serve', '-h'])).toBeUndefined();
  });

  it('is undefined for anything that is not mcp serve', () => {
    expect(mcpServeProtocolArgs(['mcp', 'login', 'server'])).toBeUndefined();
    expect(mcpServeProtocolArgs(['-p', 'mcp'])).toBeUndefined();
    expect(mcpServeProtocolArgs([])).toBeUndefined();
  });
});
