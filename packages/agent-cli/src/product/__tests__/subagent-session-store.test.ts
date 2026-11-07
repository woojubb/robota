import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getWorkspaceProjectIdentity } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { stopTestWorkspaceBroker } from '../../__tests__/helpers/approve-test-workspace.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { BrokeredWorkspaceTrustService } from '../../startup/brokered-workspace-trust.js';
import { createCliWorkspaceComposition } from '../../startup/workspace-project-composition.js';
import { createProductSubagentComposition } from '../subagent-composition.js';

const roots: string[] = [];
const trustServices: BrokeredWorkspaceTrustService[] = [];
afterEach(async () => {
  for (const trust of trustServices.splice(0)) trust.close();
  for (const root of roots.splice(0)) {
    await stopTestWorkspaceBroker(join(root, '.test-product'));
    rmSync(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-session-store-')));
  roots.push(root);
  const cwd = join(root, 'project');
  execFileSync('git', ['init', '-q', cwd]);
  const runtime = createTestProductRuntime('test-product', { HOME: root });
  const trust = await BrokeredWorkspaceTrustService.create(runtime);
  trustServices.push(trust);
  const access = await trust.grant(cwd, await trust.prepare(cwd));
  if (access.status !== 'trusted') throw new Error('Could not grant fixture trust');
  const identity = getWorkspaceProjectIdentity(access.authority);
  const resumeStore = { scope: 'project' as const, repositoryKey: identity.repositoryKey, worktreeRoot: identity.worktreeRoot };
  const parent = createCliWorkspaceComposition({ cwd, productRuntime: runtime, projectAccess: access });
  const open = createProductSubagentComposition(runtime).openSessionStore;
  if (open === undefined) throw new Error('Worker must open session stores');
  return { cwd, runtime, trust, parent, open, resumeStore };
}

function record(cwd: string) {
  return { id: 'fork-record', cwd, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messages: [] };
}

describe('product subagent session store admission', () => {
  it.runIf(process.platform === 'linux')('takes the parent project lease and saves the child turn', async () => {
    const { cwd, parent, open, resumeStore } = await fixture();
    expect(parent.sessionStoreScope).toBe('project');
    parent.sessionStore.save(record(cwd), { handoff: true });
    const lease = parent.sessionStore.lend('fork-record');
    const child = await open({ cwd, resumeStore });
    const claim = child.claim('fork-record', { lease: lease.nonce });
    child.save({ ...record(cwd), updatedAt: '2026-01-02T00:00:00.000Z' }, { claim });
    claim.release();
    lease.end();
    const result = parent.sessionStore.load('fork-record');
    expect(result.status === 'valid' && result.record.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('rejects revoked trust and mismatched workspace identity', async () => {
    const { cwd, trust, open, resumeStore } = await fixture();
    await expect(Promise.resolve(open({ cwd, resumeStore: { ...resumeStore, repositoryKey: 'different' } }))).rejects.toThrow();
    await trust.revoke(cwd);
    await expect(Promise.resolve(open({ cwd, resumeStore }))).rejects.toThrow();
  });

  it('keeps an explicitly selected user store even when the project is trusted', async () => {
    const { cwd, runtime, open } = await fixture();
    const user = createCliWorkspaceComposition({ cwd, productRuntime: runtime }).sessionStore;
    user.save(record(cwd), { handoff: true });
    const lease = user.lend('fork-record');
    const child = await open({ cwd, resumeStore: { scope: 'user' } });
    const claim = child.claim('fork-record', { lease: lease.nonce });
    expect(claim.outcome.status).toBe('valid');
    claim.release();
    lease.end();
  });
});
