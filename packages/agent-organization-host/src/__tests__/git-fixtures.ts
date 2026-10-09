import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { OrganizationGitAsset, createOrganizationGitActions } from '../index.js';
import type { IOrganizationRequest, TOrganizationJson } from '../index.js';
import { fixture, keys, signed } from './fixtures.js';

export function gitFixture() {
  let now = Date.now();
  const f = fixture({ now: () => now });
  const path = join(f.directory, 'asset.git');
  execFileSync('/usr/bin/git', ['init', '--bare', path], { env: {}, stdio: 'ignore' });
  chmodSync(path, 0o700);
  function git(args: string[], input?: string) {
    return execFileSync('/usr/bin/git', ['--git-dir', path, ...args], {
      input,
      encoding: 'utf8',
      env: {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      },
    }).trim();
  }
  const tree = git(['mktree'], '');
  const initial = git(['commit-tree', tree], 'initial\n');
  git(['update-ref', 'refs/heads/work', initial]);
  const first = git(['commit-tree', tree, '-p', initial], 'candidate one\n');
  const second = git(['commit-tree', tree, '-p', initial], 'candidate two\n');
  const unrelated = git(['commit-tree', tree], 'unrelated history\n');
  const asset = new OrganizationGitAsset({ path, ref: 'refs/heads/work', gitPath: '/usr/bin/git' });
  f.ledger.createStateResource('company', 'task', 'source', { oid: initial });
  const actors = [keys(), keys()];
  const grants = actors.map((key, index) => ({
    ...f.grant,
    id: `git-${index}`,
    actor: `git-actor-${index}`,
    publicKey: key.publicKey,
    scopes: [{ resource: 'source', operations: ['state.read', 'state.lease', 'git.publish'] }],
  }));
  for (const grant of grants)
    f.ledger.registerGrant(signed('workload', grant, f.issuer.privateKey));
  const reservation = { tokens: 0, timeMs: 5000, costMicros: 0 };
  const broker = f.broker(
    createOrganizationGitActions(f.ledger, {
      resource: 'source',
      asset,
      readRoles: ['operator'],
      writeRoles: ['operator'],
      reservation,
    }),
  );
  function request(
    actor: number,
    operation: string,
    parameters: TOrganizationJson,
  ): IOrganizationRequest {
    const grant = grants[actor]!;
    return f.request({
      grantId: grant.id,
      actor: grant.actor,
      operation: {
        idempotencyKey: randomUUID(),
        resource: 'source',
        operation,
        environment: 'test',
        parameters,
      },
    });
  }
  function call(request: IOrganizationRequest, approval = false) {
    const actor = grants.findIndex((grant) => grant.id === request.grantId);
    return f.call(request, approval ? f.approval(request) : null, actors[actor]!.privateKey);
  }
  async function lease(actor = 0) {
    const req = request(actor, 'state.lease', { expectedRevision: 0, ttlMs: 5000 });
    const result = (await broker.apply(call(req))).value as { fence: number };
    return result.fence;
  }
  function publish(fence: number, overrides: TOrganizationJson = {}, actor = 0) {
    return request(actor, 'git.publish', {
      expectedRevision: 0,
      fence,
      expectedOid: initial,
      candidateOid: first,
      ...(overrides as object),
    });
  }
  function reserve(req: IOrganizationRequest) {
    const proof = call(req, true);
    f.ledger.reserve(proof.request, reservation, proof.approval, true);
    return proof.request;
  }
  return {
    ...f,
    path,
    git,
    tree,
    initial,
    first,
    second,
    unrelated,
    asset,
    actors,
    grants,
    broker,
    request,
    call,
    lease,
    publish,
    reserve,
    reservation,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
