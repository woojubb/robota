import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MCPActivationAdmissionService } from '@robota-sdk/agent-mcp';
import { afterEach, describe, expect, it } from 'vitest';

import { createFileMcpApprovalStore, resolveMcpApprovalStore } from '../mcp-approval-file-store.js';

import type { IMCPActivationRequest } from '@robota-sdk/agent-mcp';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'robota-mcp-approvals-'));
  roots.push(root);
  return join(root, '.robota', 'mcp-approvals.json');
}

function request(overrides: Partial<IMCPActivationRequest> = {}): IMCPActivationRequest {
  return {
    serverId: 'docs',
    endpoint: 'https://mcp.example.test/mcp',
    source: 'project',
    provenance: { kind: 'project', id: 'workspace-settings', version: '1' },
    definitionFingerprint: 'definition-v1',
    securityIdentity: 'identity-v1',
    workspace: { repositoryKey: 'repo-1', trustState: 'trusted', generation: 1 },
    ...overrides,
  };
}

describe('the file-backed MCP approval store', () => {
  it('keeps an approval for the next process', () => {
    const path = storePath();
    new MCPActivationAdmissionService(createFileMcpApprovalStore(path)).approve(request());

    const nextProcess = new MCPActivationAdmissionService(createFileMcpApprovalStore(path));

    expect(nextProcess.admit(request())).toMatchObject({ status: 'approved', allowed: true });
    expect(nextProcess.listAudit()).toHaveLength(1);
  });

  it('does not carry an approval to a changed definition', () => {
    const path = storePath();
    new MCPActivationAdmissionService(createFileMcpApprovalStore(path)).approve(request());

    const nextProcess = new MCPActivationAdmissionService(createFileMcpApprovalStore(path));

    expect(nextProcess.admit(request({ definitionFingerprint: 'definition-v2' })).allowed).toBe(
      false,
    );
  });

  it('keeps one decision per server and repository, the latest', () => {
    const path = storePath();
    const service = new MCPActivationAdmissionService(createFileMcpApprovalStore(path));
    const otherRepository = request({
      workspace: { repositoryKey: 'repo-2', trustState: 'trusted', generation: 1 },
    });
    service.approve(request());
    service.approve(otherRepository);
    service.revoke(request());

    const records = createFileMcpApprovalStore(path).list();

    expect(records).toHaveLength(2);
    expect(service.admit(request()).allowed).toBe(false);
    expect(service.admit(otherRepository).allowed).toBe(true);
  });

  it('writes a file only its owner can read', () => {
    if (process.platform === 'win32') return;
    const path = storePath();
    new MCPActivationAdmissionService(createFileMcpApprovalStore(path)).approve(request());

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf8')).not.toContain('https://mcp.example.test');
  });

  it('reads a corrupt file as no approvals, and the next decision writes a valid one', () => {
    const path = storePath();
    new MCPActivationAdmissionService(createFileMcpApprovalStore(path)).approve(request());
    writeFileSync(path, '{ "version": 1, "records": [ }');

    const service = new MCPActivationAdmissionService(createFileMcpApprovalStore(path));
    expect(service.admit(request()).allowed).toBe(false);

    service.approve(request());
    expect(
      new MCPActivationAdmissionService(createFileMcpApprovalStore(path)).admit(request()).allowed,
    ).toBe(true);
  });

  it('is what a CLI session uses unless the host supplies a store', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-mcp-approvals-home-'));
    roots.push(home);
    new MCPActivationAdmissionService(resolveMcpApprovalStore(undefined, home)).approve(request());

    expect(
      new MCPActivationAdmissionService(resolveMcpApprovalStore(undefined, home)).admit(request())
        .allowed,
    ).toBe(true);
    const supplied = createFileMcpApprovalStore(storePath());
    expect(resolveMcpApprovalStore(supplied, home)).toBe(supplied);
  });
});
