import { describe, expect, it } from 'vitest';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { executeMCPActivationCommand } from '../mcp-activation-command.js';

import type {
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
} from '@robota-sdk/agent-framework';

function summary(
  overrides: Partial<ICommandMCPActivationSummary> = {},
): ICommandMCPActivationSummary {
  return {
    serverId: 'server-1',
    displayName: 'Example server',
    source: 'project',
    status: 'pending',
    allowed: false,
    reason: 'Approval required.',
    provenanceId: 'project-settings',
    definitionFingerprint: 'definition-v1',
    securityIdentity: 'identity-v1',
    ...overrides,
  };
}

function context(adapter?: ICommandMCPActivationAdapter) {
  return createTestCommandHost({
    overrides: { getCommandHostAdapters: () => (adapter ? { mcpActivation: adapter } : {}) },
  });
}

describe('executeMCPActivationCommand', () => {
  it('lists status without invoking an activation operation', async () => {
    let operations = 0;
    const entry = summary();
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [entry],
      approve: async () => {
        operations++;
        return entry;
      },
      reject: async () => entry,
      revoke: async () => entry,
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).toContain('pending');
    expect(result.message).toContain('server-1');
    expect(operations).toBe(0);
  });

  it('routes approve/reject/revoke to the host adapter and preserves the exact id', async () => {
    const calls: string[] = [];
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      approve: (id) => {
        calls.push(`approve:${id}`);
        return summary({ status: 'approved', allowed: true, reason: 'Approved.' });
      },
      reject: (id) => {
        calls.push(`reject:${id}`);
        return summary({ status: 'rejected', reason: 'Rejected.' });
      },
      revoke: (id) => {
        calls.push(`revoke:${id}`);
        return summary({ status: 'revoked', reason: 'Revoked.' });
      },
    };

    expect((await executeMCPActivationCommand(context(adapter), 'approve Server-A')).success).toBe(
      true,
    );
    expect((await executeMCPActivationCommand(context(adapter), 'reject Server-A')).success).toBe(
      true,
    );
    expect((await executeMCPActivationCommand(context(adapter), 'revoke Server-A')).success).toBe(
      true,
    );
    expect(calls).toEqual(['approve:Server-A', 'reject:Server-A', 'revoke:Server-A']);
  });

  it('does not guess an id and never activates when the adapter is absent', async () => {
    expect((await executeMCPActivationCommand(context(), '')).success).toBe(true);
    expect((await executeMCPActivationCommand(context(), 'approve')).success).toBe(false);
    expect((await executeMCPActivationCommand(context(), 'approve server-1')).message).toMatch(
      /not available/i,
    );
  });

  // BEHAVIOR-2794 (issue #2794 / #3073): a source-level problem (an unreadable managed policy, a
  // config root that is not an object, no `mcpServers`) names no server, so it never appears in
  // `list()`. Before `sourceProblems()` existed on the adapter, `/mcp status` had no way to say an
  // entire source could not be read — it just said nothing beyond whatever DID resolve.
  it('states which source could not be read, beside the servers that did resolve', async () => {
    const entry = summary();
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [entry],
      sourceProblems: () => [
        {
          source: 'managed',
          origin: 'policy.json',
          reason: 'the configuration root is not an object',
        },
      ],
      approve: async () => entry,
      reject: async () => entry,
      revoke: async () => entry,
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    // The resolved server is still reported...
    expect(result.message).toContain('server-1');
    // ...beside the source that could not be read at all.
    expect(result.message).toContain('managed');
    expect(result.message).toContain('policy.json');
    expect(result.message).toContain('the configuration root is not an object');
    expect(result.data).toMatchObject({
      sourceProblems: [
        {
          source: 'managed',
          origin: 'policy.json',
          reason: 'the configuration root is not an object',
        },
      ],
    });
  });

  // PR #3076 re-review: a managed-tier source problem also blocks every lower-tier server that would
  // otherwise have resolved (`agent-mcp`'s `resolveByPrecedence`) — those names never appear in
  // `list()` (an `unresolved` entry is never an activation candidate), so this line is the ONLY place
  // `/mcp status` can say a lower-tier server exists at all and why it is not active.
  it('states that lower-tier servers are blocked, listing their names, for a managed source problem', async () => {
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      sourceProblems: () => [
        {
          source: 'managed',
          origin: 'policy.json',
          reason: 'the configuration root is not an object',
          blockedServerNames: ['weather', 'search'],
        },
      ],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).toContain('managed');
    expect(result.message).toContain('policy.json');
    expect(result.message).toMatch(/blocked/i);
    expect(result.message).toContain('weather');
    expect(result.message).toContain('search');
  });

  it('says nothing extra about blocking for a source problem with no blocked servers', async () => {
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      sourceProblems: () => [
        { source: 'user', origin: 'settings.json', reason: '`mcpServers` is not an object' },
      ],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/blocked/i);
  });

  it('reports a source problem even when nothing resolved at all', async () => {
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      sourceProblems: () => [
        { source: 'managed', origin: 'policy.json', reason: 'no `mcpServers` key' },
      ],
      approve: async () => summary(),
      reject: async () => summary(),
      revoke: async () => summary(),
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/no mcp definitions are registered/i);
    expect(result.message).toContain('managed');
    expect(result.message).toContain('policy.json');
  });

  it('treats a missing sourceProblems() the same as none, for an older adapter', async () => {
    const entry = summary();
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [entry],
      approve: async () => entry,
      reject: async () => entry,
      revoke: async () => entry,
    };

    const result = await executeMCPActivationCommand(context(adapter), 'status');

    expect(result.success).toBe(true);
    expect(result.message).toContain('server-1');
  });
});
