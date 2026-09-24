import { describe, expect, it } from 'vitest';

import { buildServeSessionOptions } from '../serve-mode.js';

describe('serve and MCP provider recovery guidance', () => {
  it('preserves host model identifiers in both served modes', () => {
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
      promptFileReferenceTag: 'acme_files',
      modelCommandToolPrefix: 'acme_command_',
      subagentHookEnvironmentNames: { agentId: 'ACME_AGENT_ID', agentType: 'ACME_AGENT_TYPE' },
    } as never);

    expect(options.promptFileReferenceTag).toBe('acme_files');
    expect(options.modelCommandToolPrefix).toBe('acme_command_');
    expect(options.subagentHookEnvironmentNames).toEqual({
      agentId: 'ACME_AGENT_ID', agentType: 'ACME_AGENT_TYPE',
    });
  });

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
