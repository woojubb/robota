import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrganizationGitAsset, OrganizationLedger } from '../index.js';
import type { TOrganizationJson } from '../index.js';
import { gitFixture } from './git-fixtures.js';

const fixtures: ReturnType<typeof gitFixture>[] = [];
const reopened: OrganizationLedger[] = [];
afterEach(() => {
  for (const ledger of reopened.splice(0)) ledger.close();
  for (const f of fixtures.splice(0)) f.cleanup();
});

function setup() {
  const f = gitFixture();
  fixtures.push(f);
  return f;
}

describe('owner-controlled Git publication', () => {
  it('requires exact operator approval, preserves candidate history/tree and returns the actual publication OID once', async () => {
    const f = setup();
    const fence = await f.lease();
    const req = f.publish(fence);
    await expect(f.broker.apply(f.call(req))).rejects.toThrow('approval-required');
    const receipt = await f.broker.apply(f.call(req, true));
    const result = receipt.value as { revision: number; value: { oid: string } };
    expect(result.revision).toBe(1);
    expect(result.value.oid).not.toBe(f.first);
    expect(f.git(['rev-parse', 'refs/heads/work'])).toBe(result.value.oid);
    expect(f.git(['rev-parse', `${result.value.oid}^`])).toBe(f.first);
    expect(f.git(['rev-parse', `${result.value.oid}^{tree}`])).toBe(f.tree);
    const retry = { ...req, nonce: randomUUID() };
    expect((await f.broker.apply(f.call(retry))).value).toEqual(receipt.value);
    expect(f.ledger.budgetState('global').held.timeMs).toBe(0);
  });

  it('rejects stale/copy fences, revisions, branch OIDs and conflicting history before publishing', async () => {
    const f = setup();
    const fence = await f.lease();
    for (const req of [
      f.publish(fence, {}, 1),
      f.publish(fence + 1),
      f.publish(fence, { expectedRevision: 1 }),
      f.publish(fence, { expectedOid: f.second }),
      f.publish(fence, { candidateOid: f.unrelated }),
    ])
      await expect(f.broker.apply(f.call(req, true))).rejects.toThrow('operation-conflict');
    expect(f.git(['rev-parse', 'refs/heads/work'])).toBe(f.initial);
    expect(f.ledger.budgetState('global').held.timeMs).toBe(0);
  });

  it('rejects command/path/zero-OID input before reservation and pins the owner repository identity', async () => {
    const f = setup();
    const fence = await f.lease();
    for (const parameters of [
      { candidateOid: '--help' },
      { candidateOid: '0'.repeat(40) },
      { path: '/other' },
    ] as TOrganizationJson[])
      await expect(f.broker.apply(f.call(f.publish(fence, parameters), true))).rejects.toThrow(
        'invalid-schema',
      );
    expect(f.ledger.budgetState('global').held.timeMs).toBe(0);
    chmodSync(f.path, 0o777);
    await expect(f.broker.apply(f.call(f.publish(fence), true))).rejects.toThrow('outcome-unknown');
    expect(f.git(['rev-parse', 'refs/heads/work'])).toBe(f.initial);
  });

  it('does not execute repository hooks, signing programs or ambient Git overrides', async () => {
    const f = setup();
    const marker = join(f.directory, 'hook-ran');
    const hooks = join(f.directory, 'evil-hooks');
    mkdirSync(hooks);
    const script = `#!/bin/sh\nprintf 'ran' > '${marker}'\nexit 0\n`;
    const hook = join(hooks, 'reference-transaction');
    writeFileSync(hook, script, { mode: 0o700 });
    f.git(['config', 'core.hooksPath', hooks]);
    f.git(['config', 'commit.gpgSign', 'true']);
    f.git(['config', 'gpg.program', hook]);
    const fence = await f.lease();
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = '/invalid-ambient-repository';
    try {
      await f.broker.apply(f.call(f.publish(fence), true));
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
    expect(existsSync(marker)).toBe(false);
  });

  it('retains a prepared hold after revoke and never treats an unreferenced object as publication proof', async () => {
    const f = setup();
    const fence = await f.lease();
    const req = f.publish(fence);
    const proof = f.reserve(req);
    const intent = f.ledger.prepareGitPublication(proof, f.asset);
    expect(f.git(['cat-file', '-t', intent.publishedOid])).toBe('commit');
    expect(() => f.ledger.reconcileGitPublication(req, f.asset)).toThrow('outcome-unknown');
    f.ledger.revokeGrant(req.grantId);
    expect(() => f.ledger.commitGitPublication(proof, f.asset)).toThrow('revoked');
    expect(() =>
      f.ledger.confirmNoEffect(req, 'revoked', { tokens: 0, timeMs: 0, costMicros: 0 }),
    ).toThrow('outcome-unknown');
    expect(f.git(['rev-parse', 'refs/heads/work'])).toBe(f.initial);
    expect(f.ledger.budgetState('global').held.timeMs).toBe(5000);
  });

  it('does not force-update after a branch conflict between durable intent and dispatch', async () => {
    const f = setup();
    const req = f.publish(await f.lease());
    const proof = f.reserve(req);
    f.ledger.prepareGitPublication(proof, f.asset);
    f.git(['update-ref', 'refs/heads/work', f.second, f.initial]);
    expect(() => f.ledger.commitGitPublication(proof, f.asset)).toThrow('operation-conflict');
    expect(f.git(['rev-parse', 'refs/heads/work'])).toBe(f.second);
    expect(() => f.ledger.reconcileGitPublication(req, f.asset)).toThrow('outcome-unknown');
    expect(f.ledger.budgetState('global').held.timeMs).toBe(5000);
  });

  it('rejects a different asset and a rolled-back target ref as recovery evidence', async () => {
    const f = setup();
    const req = f.publish(await f.lease());
    const proof = f.reserve(req);
    const intent = f.ledger.prepareGitPublication(proof, f.asset);
    f.asset.publish(intent);
    f.git(['update-ref', 'refs/heads/other', intent.publishedOid]);
    const other = new OrganizationGitAsset({
      path: f.path,
      ref: 'refs/heads/other',
      gitPath: '/usr/bin/git',
    });
    expect(() => f.ledger.reconcileGitPublication(req, other)).toThrow('operation-conflict');
    f.git(['update-ref', 'refs/heads/work', f.initial, intent.publishedOid]);
    expect(() => f.ledger.reconcileGitPublication(req, f.asset)).toThrow('outcome-unknown');
    expect(f.ledger.budgetState('global').held.timeMs).toBe(5000);
  });

  it('proves a Git publication independently of a rolled-back SQLite effect, charges once after stop and never revives authority', async () => {
    const f = setup();
    const fence = await f.lease();
    const req = f.publish(fence);
    const proof = f.reserve(req);
    const intent = f.ledger.prepareGitPublication(proof, f.asset);
    // The external ref changed, but the SQLite effect transaction never committed.
    f.asset.publish(intent);
    f.ledger.close();
    const owner = new OrganizationLedger(f.ledgerOptions);
    reopened.push(owner);
    owner.revokeGrant(req.grantId);
    owner.stopTask('company', 'task');
    f.advance(30_000);
    const receipt = owner.reconcileGitPublication(req, f.asset);
    expect(receipt.value).toEqual({ revision: 1, value: { oid: intent.publishedOid } });
    expect(receipt.usage.timeMs).toBe(5000);
    expect(owner.reconcileGitPublication(req, f.asset)).toEqual(receipt);
    expect(owner.budgetState('global').held.timeMs).toBe(0);
    expect(() => owner.authenticate(proof)).toThrow('revoked');
    expect(f.git(['rev-parse', 'refs/heads/work'])).toBe(intent.publishedOid);
  });
});
