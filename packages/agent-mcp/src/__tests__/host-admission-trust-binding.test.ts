import { describe, expect, it } from 'vitest';

import {
  InMemoryMCPActivationApprovalStore,
  MCPActivationAdmissionService,
  MCPActivationPolicyError,
} from '../mcp-activation.js';

import type {
  IMCPActivationApprovalRecord,
  IMCPActivationRequest,
  TMCPActivationSource,
  TMCPApprovalAuthority,
} from '../mcp-activation.js';

function request(overrides: Partial<IMCPActivationRequest> = {}): IMCPActivationRequest {
  return {
    serverId: 'server-1',
    endpoint: 'https://mcp.example.test/mcp',
    source: 'project',
    provenance: { kind: 'project', id: 'workspace-settings', version: '1' },
    definitionFingerprint: 'definition-v1',
    securityIdentity: 'identity-v1',
    workspace: { repositoryKey: 'repo-1', trustState: 'trusted', generation: 4 },
    ...overrides,
  };
}

describe('MCP activation host admission trust binding', () => {
  it('refuses an untrusted project workspace even when an approval record exists', () => {
    const store = new InMemoryMCPActivationApprovalStore();
    const service = new MCPActivationAdmissionService(store);

    const trusted = request();
    expect(service.approve(trusted).status).toBe('approved');

    const untrusted = request({
      workspace: { repositoryKey: 'repo-1', trustState: 'untrusted', generation: 4 },
    });

    // The service must not fall through to the stored approval when the presented
    // workspace itself is untrusted — untrust is checked before any record lookup.
    expect(service.admit(untrusted).status).toBe('untrusted');
    expect(service.admit(untrusted).allowed).toBe(false);
  });

  it('does not admit an approval granted at one trust generation against a later generation', () => {
    const service = new MCPActivationAdmissionService();
    const generationOne = request({
      workspace: { repositoryKey: 'repo-1', trustState: 'trusted', generation: 1 },
    });

    expect(service.approve(generationOne).status).toBe('approved');
    expect(service.admit(generationOne).status).toBe('approved');
    expect(service.admit(generationOne).allowed).toBe(true);

    const generationTwo = request({
      workspace: { repositoryKey: 'repo-1', trustState: 'trusted', generation: 2 },
    });

    expect(service.admit(generationTwo).status).toBe('stale');
    expect(service.admit(generationTwo).allowed).toBe(false);
  });

  it('denies by default: an unknown source is treated like project, not like user', () => {
    const service = new MCPActivationAdmissionService();
    const store = service.getApprovalStore();

    // Red-proof: with the old require-list form (`source === 'project' || source === 'plugin'
    // || source === 'local'`), an unknown member such as 'workflow' would fall through to
    // `false` from `requiresTrustedWorkspace`, meaning it would be treated as unbound (like
    // 'managed'/'user') and would be approved by a record with no repositoryKey/workspaceGeneration
    // even with no workspace at all. The allowlist form denies by default: any source not in
    // {'managed','user'} requires a trusted workspace, so the same record does NOT admit an
    // unknown-source request that carries no workspace.
    const unknownSource = 'workflow' as unknown as TMCPActivationSource;

    const unboundRecord: IMCPActivationApprovalRecord = {
      serverId: 'server-unknown',
      source: unknownSource,
      provenance: { kind: unknownSource, id: 'workflow-owner' },
      definitionFingerprint: 'definition-v1',
      securityIdentity: 'identity-v1',
      approvalAuthority: 'user',
      decision: 'approved',
      decidedAt: '2026-09-22T00:00:00.000Z',
      // repositoryKey and workspaceGeneration intentionally left undefined, matching how an
      // unbound ('managed'/'user') approval is recorded.
    };
    store.put(unboundRecord);

    const unknownSourceRequest: IMCPActivationRequest = {
      serverId: 'server-unknown',
      endpoint: 'https://mcp.example.test/mcp',
      source: unknownSource,
      provenance: { kind: unknownSource, id: 'workflow-owner' },
      definitionFingerprint: 'definition-v1',
      securityIdentity: 'identity-v1',
      // no workspace at all
    };

    const unknownResult = service.admit(unknownSourceRequest);
    expect(unknownResult.status).not.toBe('approved');
    expect(unknownResult.allowed).toBe(false);

    // Contrast: the same record shape, but for a genuinely unbound 'user' source, IS approved.
    const userRecord: IMCPActivationApprovalRecord = {
      serverId: 'server-user',
      source: 'user',
      provenance: { kind: 'user', id: 'workflow-owner' },
      definitionFingerprint: 'definition-v1',
      securityIdentity: 'identity-v1',
      approvalAuthority: 'user',
      decision: 'approved',
      decidedAt: '2026-09-22T00:00:00.000Z',
    };
    store.put(userRecord);

    const userRequest: IMCPActivationRequest = {
      serverId: 'server-user',
      endpoint: 'https://mcp.example.test/mcp',
      source: 'user',
      provenance: { kind: 'user', id: 'workflow-owner' },
      definitionFingerprint: 'definition-v1',
      securityIdentity: 'identity-v1',
    };

    const userResult = service.admit(userRequest);
    expect(userResult.status).toBe('approved');
    expect(userResult.allowed).toBe(true);
  });

  it('denies by default: an authority outside the union cannot approve, reject, or revoke', () => {
    const service = new MCPActivationAdmissionService();
    const trustedRequest = request();

    // Mirrors the unknown-SOURCE red-proof above, but for the DECIDING authority instead: with the
    // old require-list form (`authority === 'project' || authority === 'plugin'`), an authority
    // outside the union — cast the same way the unknown-source case does — would fall through to
    // `false` and be treated as allowed to decide. The allowlist form refuses by default.
    const unknownAuthority = 'workflow' as unknown as TMCPApprovalAuthority;

    expect(() => service.approve(trustedRequest, unknownAuthority)).toThrow(
      MCPActivationPolicyError,
    );
    expect(() => service.reject(trustedRequest, unknownAuthority)).toThrow(
      MCPActivationPolicyError,
    );
    expect(() => service.revoke(trustedRequest, unknownAuthority)).toThrow(
      MCPActivationPolicyError,
    );
  });
});
