import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { OrganizationLedger } from '../index.js';
import type { IOrganizationRequest, TOrganizationJson } from '../index.js';
import { gitFixture } from './git-fixtures.js';

interface IMessage {
  readonly kind: string;
  readonly endpoint?: string;
  readonly status?: number;
  readonly request?: IOrganizationRequest;
  readonly body?: {
    readonly refused?: string;
    readonly receipt?: {
      readonly value: {
        readonly revision: number;
        readonly fence: number;
        readonly value: { readonly oid: string };
      };
    };
  };
}
const fixtures: ReturnType<typeof gitFixture>[] = [];
const children: ChildProcess[] = [];
const reopened: OrganizationLedger[] = [];
const wrapperPids: number[] = [];

function message(child: ChildProcess, kind: string): Promise<IMessage> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      child.off('message', receive);
      child.off('error', failed);
      child.off('exit', failed);
    };
    const failed = (): void => {
      cleanup();
      reject(new Error('Git fixture child failed'));
    };
    const receive = (data: unknown): void => {
      const value = data as IMessage;
      if (value.kind === 'fixture-error') failed();
      else if (value.kind === kind) {
        cleanup();
        resolve(value);
      }
    };
    child.on('message', receive);
    child.once('error', failed);
    child.once('exit', failed);
  });
}
async function launch(script: string, directory: string, options: object) {
  const child = fork(fileURLToPath(new URL(script, import.meta.url)), [], {
    cwd: mkdtempSync(join(directory, 'child-')),
    env: {},
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  await message(child, 'ready');
  const initialized = message(child, 'initialized');
  child.send({ kind: 'initialize', ...options });
  return { child, initialized: await initialized };
}
async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}
afterEach(async () => {
  for (const pid of wrapperPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
      wrapperPids.splice(wrapperPids.indexOf(pid), 1);
    } catch {
      /* already gone */
    }
  }
  await Promise.all(children.splice(0).map(kill));
  for (const ledger of reopened.splice(0)) ledger.close();
  for (const f of fixtures.splice(0)) f.cleanup();
});

async function setup(crash?: 'before' | 'after') {
  const f = gitFixture();
  fixtures.push(f);
  let gitPath = '/usr/bin/git';
  const marker = join(f.directory, 'git-barrier-pid');
  if (crash) {
    gitPath = join(f.directory, 'git-fixture-wrapper');
    const barrier = `printf '%s' "$$" > '${marker}'\nkill -STOP "$$"\n`;
    // Pause in the owner executable, exactly before/after the real update-ref. Parent explicitly reaps it.
    writeFileSync(
      gitPath,
      `#!/bin/sh\nfixture_update=0\nfor fixture_arg in "$@"; do\n  if [ "$fixture_arg" = update-ref ]; then fixture_update=1; fi\ndone\n${crash === 'before' ? `if [ "$fixture_update" = 1 ]; then\n${barrier}fi\n` : ''}/usr/bin/git "$@"\nfixture_status=$?\n${crash === 'after' ? `if [ "$fixture_update" = 1 ] && [ "$fixture_status" = 0 ]; then\n${barrier}fi\n` : ''}exit "$fixture_status"\n`,
      { mode: 0o700 },
    );
  }
  const options = f.ledgerOptions;
  const replicaOptions = { options, asset: { path: f.path, ref: 'refs/heads/work', gitPath } };
  const replicas = await Promise.all([
    launch('./git-replica.mjs', f.directory, replicaOptions),
    launch('./git-replica.mjs', f.directory, {
      ...replicaOptions,
      asset: { ...replicaOptions.asset, gitPath: '/usr/bin/git' },
    }),
  ]);
  const workers = await Promise.all(
    f.actors.map((key, index) =>
      launch('./git-worker.mjs', f.directory, {
        grant: f.grants[index],
        workerKey: key.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      }),
    ),
  );
  function apply(
    actor: number,
    replica: number,
    operation: string,
    parameters: TOrganizationJson,
    idempotencyKey = randomUUID(),
  ) {
    const worker = workers[actor]!.child;
    const response = message(worker, 'result');
    const req = f.request(actor, operation, parameters);
    const approval =
      operation === 'git.publish'
        ? f.approval({ ...req, operation: { ...req.operation, idempotencyKey } })
        : null;
    worker.send({
      kind: 'apply',
      endpoint: replicas[replica]!.initialized.endpoint,
      operation,
      parameters,
      idempotencyKey,
      approval,
    });
    return response;
  }
  return { ...f, options, replicas, workers, marker, apply };
}

async function barrier(path: string): Promise<number> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    // Creation and printf are separate syscalls; do not mistake a momentarily empty file for a PID.
    const pid = existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
    if (Number.isSafeInteger(pid) && pid > 1) {
      wrapperPids.push(pid);
      return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Git publication barrier not reached');
}

describe('real worker/broker Git races and cross-store crash recovery', () => {
  it('races two signed workers through independent brokers and prevents a stale actor from publishing over the winner', async () => {
    const f = await setup();
    const leases = await Promise.all([
      f.apply(0, 0, 'state.lease', { expectedRevision: 0, ttlMs: 5000 }),
      f.apply(1, 1, 'state.lease', { expectedRevision: 0, ttlMs: 5000 }),
    ]);
    expect(leases.map((r) => r.status).sort()).toEqual([200, 403]);
    const winner = leases[0]!.status === 200 ? 0 : 1;
    const loser = 1 - winner;
    const fence = leases[winner]!.body!.receipt!.value.fence;
    const parameters = {
      expectedRevision: 0,
      fence,
      expectedOid: f.initial,
      candidateOid: f.first,
    };
    const published = await f.apply(winner, winner, 'git.publish', parameters);
    expect(published.status).toBe(200);
    const oid = published.body!.receipt!.value.value.oid;
    expect(
      (await f.apply(loser, loser, 'git.publish', { ...parameters, candidateOid: f.second }))
        .status,
    ).toBe(403);
    expect(f.git(['rev-parse', 'refs/heads/work'])).toBe(oid);
    expect(f.ledger.budgetState('global').held.timeMs).toBe(0);
  });

  for (const point of ['before', 'after'] as const)
    it(`kills the broker ${point} Git CAS with SQLite transaction still open, reopens disk and never retries blindly`, async () => {
      const f = await setup(point);
      const lease = await f.apply(0, 0, 'state.lease', { expectedRevision: 0, ttlMs: 5000 });
      expect(lease.status).toBe(200);
      const fence = lease.body!.receipt!.value.fence;
      const parameters = {
        expectedRevision: 0,
        fence,
        expectedOid: f.initial,
        candidateOid: f.first,
      };
      const id = randomUUID();
      const pending = f.apply(0, 0, 'git.publish', parameters, id);
      const pid = await barrier(f.marker);
      await kill(f.replicas[0]!.child);
      process.kill(pid, 'SIGKILL');
      wrapperPids.splice(wrapperPids.indexOf(pid), 1);
      const lost = await pending;
      expect(lost.status).toBe(503);
      f.ledger.close();
      const owner = new OrganizationLedger(f.options);
      reopened.push(owner);
      expect(owner.budgetState('global').held.timeMs).toBe(5000);
      expect((await f.apply(0, 1, 'git.publish', parameters, id)).body!.refused).toBe(
        'operation-pending',
      );
      const tip = f.git(['rev-parse', 'refs/heads/work']);
      if (point === 'before') {
        expect(tip).toBe(f.initial);
        expect(() => owner.reconcileGitPublication(lost.request!, f.asset)).toThrow(
          'outcome-unknown',
        );
        expect(owner.budgetState('global').held.timeMs).toBe(5000);
      } else {
        expect(tip).not.toBe(f.initial);
        owner.revokeGrant(lost.request!.grantId);
        owner.stopTask('company', 'task');
        const receipt = owner.reconcileGitPublication(lost.request!, f.asset);
        expect(receipt.value).toEqual({ revision: 1, value: { oid: tip } });
        expect(receipt.usage.timeMs).toBe(5000);
        expect(owner.reconcileGitPublication(lost.request!, f.asset)).toEqual(receipt);
        expect(owner.budgetState('global').held.timeMs).toBe(0);
        expect(() => owner.authenticate(f.call(lost.request!).request)).toThrow('revoked');
        expect(f.git(['rev-list', '--count', 'refs/heads/work'])).toBe('3');
      }
    });
});
