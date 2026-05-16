import { describe, expect, it } from 'vitest';
import { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from '../create-tools';
import { InMemorySandboxClient } from '@robota-sdk/agent-tools';

describe('createDefaultTools', () => {
  it('assembles all default local tools and describes web tools as local tools', () => {
    expect(createDefaultTools().map((tool) => tool.getName())).toEqual([
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
    ]);

    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain('WebFetch — fetch URL content as text');
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain(
      'WebSearch — search the internet through the configured local tool',
    );
  });

  it('accepts a sandbox client while preserving the default tool list', () => {
    const sandboxClient = new InMemorySandboxClient();

    expect(createDefaultTools({ sandboxClient }).map((tool) => tool.getName())).toEqual([
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
    ]);
  });
});
