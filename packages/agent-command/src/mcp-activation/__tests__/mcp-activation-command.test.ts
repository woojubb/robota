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
});
