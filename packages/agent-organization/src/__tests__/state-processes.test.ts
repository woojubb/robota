import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrganizationLedger } from '../index.js';
import type { IOrganizationRequest, TOrganizationJson } from '../index.js';
import { fixture, keys, signed } from './fixtures.js';

interface IResult {
  readonly kind: string;
  readonly endpoint?: string;
  readonly status?: number;
  readonly body?: {
    readonly refused?: string;
    readonly receipt?: {
      readonly value: {
        readonly revision: number;
        readonly fence: number;
        readonly value: TOrganizationJson;
      };
    };
  };
  readonly request?: IOrganizationRequest;
}
const fixtures: ReturnType<typeof fixture>[] = [];
const children: ChildProcess[] = [];
const reopened: OrganizationLedger[] = [];

function waitFor(child: ChildProcess, kind: string): Promise<IResult> {
  return new Promise((resolve, reject) => {
    const clean = (): void => {
      child.removeListener('message', receive);
      child.removeListener('error', failed);
      child.removeListener('exit', ended);
    };
    const failed = (): void => {
      clean();
      reject(new Error('Fixture child failed'));
    };
    const ended = (): void => {
      clean();
      reject(new Error('Fixture child exited before response'));
    };
    const receive = (value: unknown): void => {
      const message = value as IResult;
      if (message.kind === 'fixture-error') {
        failed();
        return;
      }
      if (message.kind === kind) {
        clean();
        resolve(message);
      }
    };
    child.on('message', receive);
    child.once('error', failed);
    child.once('exit', ended);
  });
}

async function launch(
  script: string,
  directory: string,
  initialization: object,
): Promise<{ child: ChildProcess; message: IResult }> {
  const cwd = mkdtempSync(join(directory, 'process-'));
  const child = fork(fileURLToPath(new URL(script, import.meta.url)), [], {
    cwd,
    env: {},
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  await waitFor(child, 'ready');
  const pending = waitFor(child, 'initialized');
  child.send({ kind: 'initialize', ...initialization });
  return { child, message: await pending };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(stop));
  for (const ledger of reopened.splice(0)) ledger.close();
  for (const f of fixtures.splice(0)) f.cleanup();
});

async function setup(loseWriteAck = false) {
  const f = fixture();
  fixtures.push(f);
  f.ledger.createStateResource('company', 'task', 'board', { count: 0 });
  const actors = [keys(), keys()];
  const grants = actors.map((key, index) => ({
    ...f.grant,
    id: `worker-${index}`,
    actor: `actor-${index}`,
    publicKey: key.publicKey,
    scopes: [
      {
        resource: 'board',
        operations: ['state.read', 'state.lease', 'state.write'],
      },
    ],
  }));
  for (const grant of grants)
    f.ledger.registerGrant(signed('workload', grant, f.issuer.privateKey));
  const options = {
    path: f.path,
    audience: f.audience,
    workloadPublicKey: f.issuer.publicKey,
    approvalPublicKey: f.approver.publicKey,
  };
  const replicas = await Promise.all([
    launch('./state-replica.mjs', f.directory, { options, loseWriteAck }),
    launch('./state-replica.mjs', f.directory, { options }),
  ]);
  const workers = await Promise.all(
    actors.map((key, index) =>
      launch('./state-worker.mjs', f.directory, {
        grant: grants[index],
        workerKey: key.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      }),
    ),
  );
  function apply(
    actor: number,
    replica: number,
    operation: string,
    parameters: TOrganizationJson,
    idempotencyKey?: string,
  ): Promise<IResult> {
    const worker = workers[actor]!.child;
    const response = waitFor(worker, 'result');
    worker.send({
      kind: 'apply',
      endpoint: replicas[replica]!.message.endpoint,
      operation,
      parameters,
      idempotencyKey,
    });
    return response;
  }
  return { ...f, options, replicas, workers, apply };
}

describe('two real signed worker clients and independent broker replicas', () => {
  it('races the same resource over HTTP and refuses copied fences and stale revisions across replicas', async () => {
    const f = await setup();
    const leases = await Promise.all([
      f.apply(0, 0, 'state.lease', { expectedRevision: 0, ttlMs: 2000 }),
      f.apply(1, 1, 'state.lease', { expectedRevision: 0, ttlMs: 2000 }),
    ]);
    expect(leases.map((result) => result.status).sort()).toEqual([200, 403]);
    const winner = leases[0]!.status === 200 ? 0 : 1;
    const loser = 1 - winner;
    const fence = leases[winner]!.body!.receipt!.value.fence;
    const write = await f.apply(winner, winner, 'state.write', {
      expectedRevision: 0,
      fence,
      value: { winner },
    });
    expect(write.status).toBe(200);
    expect(
      (
        await f.apply(loser, loser, 'state.write', {
          expectedRevision: 1,
          fence,
          value: { stolen: true },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.apply(winner, loser, 'state.write', {
          expectedRevision: 0,
          fence,
          value: { stale: true },
        })
      ).status,
    ).toBe(403);
    const read = await f.apply(loser, loser, 'state.read', {});
    expect(read.body!.receipt!.value).toEqual({
      revision: 1,
      value: { winner },
    });
    expect(f.ledger.budgetState('global').active).toBe(0);
    expect(f.ledger.budgetState('global').held.timeMs).toBe(0);
  });

  it('kills both brokers after a real committed effect, reopens disk state and requires owner reconciliation before idempotent worker retrieval', async () => {
    const f = await setup(true);
    const lease = await f.apply(0, 0, 'state.lease', {
      expectedRevision: 0,
      ttlMs: 2000,
    });
    const fence = lease.body!.receipt!.value.fence;
    const idempotencyKey = randomUUID();
    const committed = waitFor(f.replicas[0]!.child, 'committed');
    const pending = f.apply(
      0,
      0,
      'state.write',
      { expectedRevision: 0, fence, value: { count: 9 } },
      idempotencyKey,
    );
    await committed;
    await Promise.all(f.replicas.map((replica) => stop(replica.child)));
    const lost = await pending;
    expect(lost.status).toBe(503);
    f.ledger.close();
    const owner = new OrganizationLedger(f.ledgerOptions);
    reopened.push(owner);
    expect(owner.budgetState('global').held.timeMs).toBe(1000);
    f.replicas[0] = await launch('./state-replica.mjs', f.directory, {
      options: f.options,
    });
    expect(
      (
        await f.apply(
          0,
          0,
          'state.write',
          { expectedRevision: 0, fence, value: { count: 9 } },
          idempotencyKey,
        )
      ).body!.refused,
    ).toBe('operation-pending');
    const reconciled = owner.reconcileStateOperation(lost.request!);
    expect(reconciled.value).toEqual({ revision: 1, value: { count: 9 } });
    expect(owner.budgetState('global').held.timeMs).toBe(0);
    const retrieved = await f.apply(
      0,
      0,
      'state.write',
      { expectedRevision: 0, fence, value: { count: 9 } },
      idempotencyKey,
    );
    expect(retrieved.status).toBe(200);
    expect(retrieved.body!.receipt!.value).toEqual({
      revision: 1,
      value: { count: 9 },
    });
    expect((await f.apply(1, 0, 'state.read', {})).body!.receipt!.value).toEqual({
      revision: 1,
      value: { count: 9 },
    });
  });
});
