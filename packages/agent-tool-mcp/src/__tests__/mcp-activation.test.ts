import { describe, expect, it } from 'vitest';

import {
  InMemoryMCPActivationApprovalStore,
  MCPActivationAdmissionService,
  MCPActivationPolicyError,
  createFailClosedMCPActivationAdmission,
} from '../mcp-activation.js';
import { MCPActivationController } from '../mcp-activation-controller.js';

import type { IMCPActivationRequest } from '../mcp-activation.js';

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

describe('MCP activation admission', () => {
  it('starts pending and reports status without contacting a server', () => {
    const service = new MCPActivationAdmissionService();

    expect(service.inspect(request())).toMatchObject({ status: 'pending', allowed: false });
    expect(service.getApprovalStore().listAudit()).toEqual([]);
  });

  it('requires workspace trust before a project or plugin definition can activate', () => {
    const service = new MCPActivationAdmissionService();
    const untrusted = request({
      workspace: { repositoryKey: 'repo-1', trustState: 'untrusted', generation: 4 },
    });

    expect(service.approve(untrusted)).toMatchObject({ status: 'untrusted', allowed: false });
    expect(service.getApprovalStore().list()).toEqual([]);
  });

  it('rejects self-approval from project/plugin provenance', () => {
    const service = new MCPActivationAdmissionService();

    expect(() => service.approve(request(), 'project')).toThrow(MCPActivationPolicyError);
    expect(() => service.approve(request(), 'plugin')).toThrow(/cannot approve themselves/i);
  });

  it('binds approval to provenance, definition fingerprint, identity, and trust generation', () => {
    const service = new MCPActivationAdmissionService();
    const original = request();
    expect(service.approve(original).status).toBe('approved');
    expect(service.inspect(original).allowed).toBe(true);

    expect(service.inspect(request({ definitionFingerprint: 'definition-v2' })).status).toBe(
      'stale',
    );
    expect(service.inspect(request({ securityIdentity: 'identity-v2' })).status).toBe('stale');
    expect(
      service.inspect(
        request({ provenance: { kind: 'plugin', id: 'changed-plugin', version: '1' } }),
      ).status,
    ).toBe('stale');
    expect(
      service.inspect(
        request({ workspace: { repositoryKey: 'repo-1', trustState: 'trusted', generation: 5 } }),
      ).status,
    ).toBe('stale');
  });

  it('rejects and revokes through explicit, auditable decisions', () => {
    const store = new InMemoryMCPActivationApprovalStore();
    const service = new MCPActivationAdmissionService(store, () => '2026-09-09T00:00:00.000Z');
    const candidate = request({ source: 'user', provenance: { kind: 'user', id: 'user-config' } });

    expect(service.reject(candidate).status).toBe('rejected');
    expect(service.revoke(candidate).status).toBe('revoked');
    expect(service.listAudit()).toMatchObject([
      { action: 'reject', serverId: 'server-1', decision: 'rejected' },
      { action: 'revoke', serverId: 'server-1', decision: 'revoked' },
    ]);
    expect(JSON.stringify(store.listAudit())).not.toContain('mcp.example.test');
  });

  it('uses managed, user, then local approval precedence and never lets project content approve', () => {
    const service = new MCPActivationAdmissionService();
    const candidate = request({
      source: 'project',
      provenance: { kind: 'project', id: 'project' },
    });
    const managed = service.approve(candidate, 'managed');
    expect(managed.status).toBe('approved');

    service.reject(candidate, 'user');
    expect(service.inspect(candidate).status).toBe('approved');
    service.revoke(candidate, 'managed');
    expect(service.inspect(candidate).status).toBe('revoked');

    const userOverLocal = new MCPActivationAdmissionService();
    userOverLocal.reject(candidate, 'user');
    const local = userOverLocal.approve(candidate, 'local');
    expect(local.status).toBe('rejected');
    expect(userOverLocal.inspect(candidate).status).toBe('rejected');

    const localOnly = new MCPActivationAdmissionService();
    expect(localOnly.approve(candidate, 'local').status).toBe('approved');
  });

  it('preserves plugin provenance and refuses the same plugin after its identity changes', () => {
    const service = new MCPActivationAdmissionService();
    const plugin = request({
      source: 'plugin',
      provenance: { kind: 'plugin', id: 'plugin-a', version: '2.0.0' },
    });

    expect(service.approve(plugin).status).toBe('approved');
    expect(
      service.inspect(
        request({
          source: 'plugin',
          provenance: { kind: 'plugin', id: 'plugin-a', version: '2.0.1' },
        }),
      ).status,
    ).toBe('stale');
  });

  it('fails closed when a caller does not inject an admission decision', () => {
    const admission = createFailClosedMCPActivationAdmission();
    const result = admission.admit(request());

    expect(result).toMatchObject({ status: 'pending', allowed: false });
  });

  it('provides a list/decision controller without connecting any definition', () => {
    const candidate = request();
    const service = new MCPActivationAdmissionService();
    const controller = new MCPActivationController(
      { list: () => [candidate] },
      service,
      new Map([['server-1', 'Example server']]),
    );

    expect(controller.list()[0]).toMatchObject({ serverId: 'server-1', status: 'pending' });
    expect(controller.list()[0]?.displayName).toBe('Example server');
    expect(controller.approve('server-1')).toMatchObject({ status: 'approved', allowed: true });
    expect(controller.list()[0]?.status).toBe('approved');
    expect(() => controller.approve('missing')).toThrow(/unknown MCP server/i);
  });
});
