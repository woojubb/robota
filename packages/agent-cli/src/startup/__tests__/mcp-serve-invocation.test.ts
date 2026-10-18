import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../../utils/cli-args.js';
import { mcpServeProtocolArgs, validateMcpServeInvocation } from '../mcp-serve-invocation.js';

describe('validateMcpServeInvocation', () => {
  const validate = (argv: string[]) => validateMcpServeInvocation(parseCliArgs(argv), 'test-product');

  it('asks the client only when --ask-client is given to mcp serve', () => {
    expect(validate(['mcp', 'serve', '--ask-client']).askClient).toBe(true);
    expect(validate(['mcp', 'serve']).askClient).toBe(false);
  });

  it('refuses --ask-client outside mcp serve', () => {
    expect(() => validate(['--ask-client'])).toThrow(/only valid with mcp serve/);
  });
});

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
