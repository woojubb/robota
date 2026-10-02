import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { OrganizationAudit, OrganizationFileLedgerAnchor } from '@robota-sdk/agent-organization';
import { organizationOwnerFixture, organizationOwnerAuditFixture, signed } from './organization-owner-fixture.js';
import { HostedOrganizationControl } from '../hosted-organization-control.js';
import type { IHostedOrganizationWorker } from '../hosted-organization-control.js';

it('withdraws an ancestor, cancels its active effect, and terminates every descendant process while another root remains live', async () => {
  const custody = mkdtempSync(join(tmpdir(), 'organization-custody-'));
  const f = organizationOwnerFixture(new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'company' }));
  const a = organizationOwnerAuditFixture();
  const audit = new OrganizationAudit({ stream: a.stream, publicKey: a.signer.publicKey, sink: a.sink, anchor: a.anchor });
  const processes = new Map<string, ChildProcess>();
  const receipts: string[] = [];
  const records: IHostedOrganizationWorker[] = [];
  let started!: () => void;
  const dispatch = new Promise<void>((resolve) => { started = resolve; });
  let cancelled = false;
  const child = { ...f.grant, id: 'child', parent: f.grant.id, actor: 'child-actor' };
  const grandchild = { ...child, id: 'grandchild', parent: child.id, actor: 'grandchild-actor' };
  const separate = { ...f.grant, id: 'separate', actor: 'separate-actor' };
  for (const grant of [child, grandchild, separate]) f.ledger.registerGrant(signed('workload', grant, f.issuer.privateKey));
  for (const grant of [f.grant, child, grandchild, separate]) {
    const process = spawn(globalThis.process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { process.once('spawn', resolve); process.once('error', reject); });
    processes.set(grant.id, process);
    records.push({ resource: grant.id, grantId: grant.id, epoch: grant.epoch, identity: { tenant: grant.tenant, task: grant.task, rootTask: grant.id === separate.id ? separate.id : f.grant.id, actor: grant.actor, runtime: `${grant.id}-runtime` } });
  }
  const control = new HostedOrganizationControl({
    ledger: f.ledger, audit, policyIntervalMs: 1000,
    inventory: {
      list: async () => records.filter((entry) => processes.get(entry.resource)!.exitCode === null && processes.get(entry.resource)!.signalCode === null),
      terminate: async (worker) => {
        const process = processes.get(worker.resource)!;
        if (process.exitCode !== null || process.signalCode !== null) return;
        const closed = new Promise<void>((resolve) => process.once('exit', () => resolve()));
        process.kill('SIGTERM'); await closed; receipts.push(worker.resource);
      },
    },
    incidentOwners: { detection: 'security', containment: 'runtime', assessment: 'asset-owner', recovery: 'authority-owner', report: async () => undefined },
    actions: [{ resource: 'asset', operation: 'read', roles: ['operator'], requiresApproval: false,
      reserve: () => ({ tokens: 10, timeMs: 10_000, costMicros: 10 }),
      execute: async (_operation, context) => {
        started();
        await new Promise<never>((_resolve, reject) => { context.signal.addEventListener('abort', () => { cancelled = true; reject(new Error('stopped')); }, { once: true }); });
        throw new Error('unreachable');
      },
    }],
  });
  try {
    await control.admit(records[2]!);
    const call = f.call(f.request({ grantId: grandchild.id, actor: grandchild.actor }));
    const outcome = control.apply(call).then(() => 'unexpected', (error: Error) => error.message);
    await dispatch;
    await control.stopGrant(f.grant.id);
    expect(await outcome).toContain('outcome-unknown');
    expect(cancelled).toBe(true);
    expect(receipts.sort()).toEqual(['child', 'grandchild', 'root']);
    expect(processes.get(separate.id)!.signalCode).toBeNull();
    await expect(control.admit(records[2]!)).rejects.toThrow(/revoked/u);
    expect(f.ledger.budgetState('grant', grandchild.id).held.tokens).toBe(10);
    await control.emergencyStop();
    expect(receipts).toContain(separate.id);
  } finally {
    await control.close();
    for (const process of processes.values()) process.kill('SIGKILL');
    f.cleanup(); rmSync(custody, { recursive: true, force: true });
  }
});
