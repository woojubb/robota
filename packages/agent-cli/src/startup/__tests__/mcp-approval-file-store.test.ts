import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MCPActivationAdmissionService } from '@robota-sdk/agent-mcp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFileMcpApprovalStore, resolveMcpApprovalStore } from '../mcp-approval-file-store.js';

import type { IMCPActivationRequest } from '@robota-sdk/agent-mcp';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'test-product-mcp-approvals-'));
  roots.push(root);
  return join(root, '.test-product', 'mcp-approvals.json');
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

  it('commits a decision and audit together instead of failing after saving just the decision', () => {
    const path = storePath();
    const store = createFileMcpApprovalStore(path);
    vi.spyOn(store, 'appendAudit').mockImplementation(() => {
      throw new Error('audit write failed');
    });
    const service = new MCPActivationAdmissionService(store);
    expect(service.approve(request()).allowed).toBe(true);
    expect(store.appendAudit).not.toHaveBeenCalled();
    const saved = createFileMcpApprovalStore(path);
    expect(saved.list()).toHaveLength(1);
    expect(saved.listAudit()).toHaveLength(1);
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

  it.each([
    '{ "version": 1, "records": [ }',
    JSON.stringify({ version: 2, records: [], audit: [] }),
    JSON.stringify({ version: 1, records: [{}], audit: [] }),
    JSON.stringify({ version: 1, records: [], audit: [{}] }),
  ])('withholds approval and preserves an unrecognised store: %s', (content) => {
    const path = storePath();
    new MCPActivationAdmissionService(createFileMcpApprovalStore(path)).approve(request());
    writeFileSync(path, content);
    const service = new MCPActivationAdmissionService(createFileMcpApprovalStore(path));
    expect(service.admit(request()).allowed).toBe(false);
    expect(() => service.approve(request())).toThrow(/refus.*writ/i);
    expect(readFileSync(path, 'utf8')).toBe(content);
    expect(() =>
      createFileMcpApprovalStore(path).appendAudit({
        action: 'approve',
        source: 'project',
        provenanceId: 'workspace-settings',
        definitionFingerprint: 'v1',
        securityIdentity: 'v1',
        serverId: 'docs',
        decision: 'approved',
        at: new Date().toISOString(),
      }),
    ).toThrow(/refus.*writ/i);
    expect(readFileSync(path, 'utf8')).toBe(content);
  });

  it('refuses a competing writer without losing a rejection', () => {
    const path = storePath();
    const service = new MCPActivationAdmissionService(createFileMcpApprovalStore(path));
    service.reject(request());
    const original = readFileSync(path, 'utf8');
    writeFileSync(`${path}.lock`, '', { flag: 'wx', mode: 0o600 });
    expect(() => service.approve(request())).toThrow(/another writer/);
    expect(readFileSync(path, 'utf8')).toBe(original);
    unlinkSync(`${path}.lock`);
    service.approve(request());
    expect(service.admit(request()).allowed).toBe(true);
  });

  it('is what a CLI session uses unless the host supplies a store', () => {
    const home = mkdtempSync(join(tmpdir(), 'test-product-mcp-approvals-home-'));
    roots.push(home);
    new MCPActivationAdmissionService(resolveMcpApprovalStore(undefined, createTestProductRuntime('test-product', { HOME: home }))).approve(request());

    expect(
      new MCPActivationAdmissionService(resolveMcpApprovalStore(undefined, createTestProductRuntime('test-product', { HOME: home }))).admit(request())
        .allowed,
    ).toBe(true);
    const supplied = createFileMcpApprovalStore(storePath());
    expect(resolveMcpApprovalStore(supplied, createTestProductRuntime('test-product', { HOME: home }))).toBe(supplied);
  });
});
