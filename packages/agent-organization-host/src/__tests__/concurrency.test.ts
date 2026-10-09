import { fork, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrganizationLedger } from '../index.js';
import type { IOrganizationBudget, IOrganizationCall } from '../index.js';
import { fixture, keys, signed } from './fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
const processes: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(
    processes.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once('exit', () => resolve());
          child.kill('SIGKILL');
        }),
    ),
  );
  for (const f of fixtures.splice(0)) f.cleanup();
});

async function worker(): Promise<ChildProcess> {
  const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  processes.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`worker startup exit ${code}`)));
    child.once('message', (message) => {
      if ((message as { kind: string }).kind === 'ready') resolve();
      else reject(new Error('unexpected startup'));
    });
  });
  return child;
}

function reserve(
  child: ChildProcess,
  f: ReturnType<typeof fixture>,
  call: ReturnType<ReturnType<typeof fixture>['call']>,
  effectPath?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', (message) => resolve((message as { result: string }).result));
    child.send({
      kind: 'reserve',
      options: {
        path: f.path,
        audience: f.audience,
        workloadPublicKey: f.issuer.publicKey,
        approvalPublicKey: f.approver.publicKey,
      },
      call,
      reservation: { tokens: 10, timeMs: 1000, costMicros: 10 },
      effectPath,
    });
  });
}

describe('durable authority across real Node processes', () => {
  it.each(['global', 'tenant', 'task', 'grant'] as const)(
    'atomically restricts two sibling workers against the shared %s budget',
    async (scope) => {
      const constraint: Partial<IOrganizationBudget> = { concurrency: 1 };
      const f = fixture({ constraints: { [scope]: constraint } });
      fixtures.push(f);
      const calls: IOrganizationCall[] = [];
      for (let index = 0; index < 2; index++) {
        const key = keys();
        const grant = {
          ...f.grant,
          id: `child-${index}`,
          actor: `child-actor-${index}`,
          parent: f.grant.id,
          publicKey: key.publicKey,
          budget: { ...f.grant.budget, concurrency: 1 },
        };
        f.ledger.registerGrant(signed('workload', grant, f.issuer.privateKey));
        calls.push(
          f.call(f.request({ grantId: grant.id, actor: grant.actor }), null, key.privateKey),
        );
      }
      const children = await Promise.all([worker(), worker()]);
      const results = await Promise.all(
        children.map((child, index) => reserve(child, f, calls[index]!)),
      );
      expect(results.sort()).toEqual(['budget-exhausted', 'reserved']);
      expect(
        f.ledger.budgetState(
          scope,
          ...{ global: [], tenant: ['company'], task: ['company', 'task'], grant: ['root'] }[scope],
        ).held.tokens,
      ).toBe(10);
      expect(f.ledger.budgetState('global').active).toBe(1);
    },
  );

  it.each(['tokens', 'timeMs', 'costMicros'] as const)(
    'does not copy the parent cumulative %s budget into sibling grants',
    async (unit) => {
      const f = fixture({ constraints: { grant: { [unit]: unit === 'timeMs' ? 1000 : 10 } } });
      fixtures.push(f);
      const calls: IOrganizationCall[] = [];
      for (let index = 0; index < 2; index++) {
        const key = keys();
        const grant = {
          ...f.grant,
          id: `child-${index}`,
          actor: `actor-${index}`,
          parent: f.grant.id,
          publicKey: key.publicKey,
        };
        f.ledger.registerGrant(signed('workload', grant, f.issuer.privateKey));
        calls.push(
          f.call(f.request({ grantId: grant.id, actor: grant.actor }), null, key.privateKey),
        );
      }
      const children = await Promise.all([worker(), worker()]);
      expect(
        (
          await Promise.all(children.map((child, index) => reserve(child, f, calls[index]!)))
        ).sort(),
      ).toEqual(['budget-exhausted', 'reserved']);
    },
  );

  it('keeps a crash-after-effect reservation and refuses retry after a separate process reopens the journal', async () => {
    const f = fixture();
    fixtures.push(f);
    const child = await worker();
    const request = f.request();
    const effectPath = join(f.directory, 'external-effect.txt');
    expect(await reserve(child, f, f.call(request), effectPath)).toBe('reserved');
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGKILL');
    });
    f.ledger.close();
    const recovered = new OrganizationLedger(f.ledgerOptions);
    expect(recovered.budgetState('global').held.tokens).toBe(10);
    recovered.close();
    const replacement = await worker();
    expect(
      await reserve(replacement, f, f.call({ ...request, nonce: 'after-crash' }), effectPath),
    ).toBe('operation-pending');
    expect(readFileSync(effectPath, 'utf8')).toBe('external-effect\n');
  });
});
