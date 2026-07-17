import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { describe, expect, it } from 'vitest';

import { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from '../create-tools';

import type { IRetrievalAdapter } from '@robota-sdk/agent-tools';

describe('createDefaultTools', () => {
  it('assembles all default local tools and describes web tools as local tools', () => {
    expect(createDefaultTools().map((tool) => tool.getName())).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]);

    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain('WebFetch — fetch URL content as text');
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain(
      'WebSearch — search the internet through the configured local tool',
    );
  });

  it('accepts a sandbox client while preserving the default tool list', () => {
    const sandboxClient = new InMemorySandboxClient();

    expect(createDefaultTools({ sandboxClient }).map((tool) => tool.getName())).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]);
  });

  // SELFHOST-003 TC-03: the retrieval adapter is threaded through assembly and the tool is
  // adapter-gated — absent with no adapter, present (and only then) when an adapter is supplied.
  it('TC-03: CodebaseRetrieval joins the default set only when a retrieval adapter is supplied', () => {
    expect(createDefaultTools().map((tool) => tool.getName())).not.toContain('CodebaseRetrieval');

    const retrievalAdapter: IRetrievalAdapter = {
      retrieve: async () => ({ symbols: [], totalTokens: 0 }),
    };
    expect(createDefaultTools({ retrievalAdapter }).map((tool) => tool.getName())).toContain(
      'CodebaseRetrieval',
    );
  });
});
