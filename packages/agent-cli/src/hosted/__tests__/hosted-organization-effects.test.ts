import { spawn, type ChildProcess } from 'node:child_process';
import { expect, it } from 'vitest';
import { organizationGatewayFixture } from './organization-gateway-fixture.js';

function worker(origin: string, token: string) {
  const child = spawn(process.execPath, ['-e', `
process.on('message', async ({ origin, token, key }) => {
  try {
    const response = await fetch(origin + '/v1/chat/completions', { method: 'POST', headers: {
      authorization: 'Bearer ' + token, 'content-type': 'application/json', 'idempotency-key': key,
    }, body: JSON.stringify({ model: 'pinned-model', stream: false, messages: [{ role: 'user', content: 'same effect' }] }) });
    process.send({ status: response.status, body: await response.text() });
  } catch { process.send({ status: 0, body: 'connection withdrawn' }); }
});
process.send({ ready: true });
`], { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const ready = new Promise<void>((resolve) => child.once('message', () => resolve()));
  return { child, async call(key = 'duplicate') {
    await ready;
    const result = new Promise<{ status: number; body: string }>((resolve) => child.once('message', (message) => resolve(message as { status: number; body: string })));
    child.send({ origin, token, key }); return result;
  } };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve())); child.kill('SIGKILL'); await stopped;
}

it('two real worker processes race one company operation and retry its durable receipt without another upstream effect', async () => {
  const f = await organizationGatewayFixture(); f.setMode('pending');
  const first = worker(f.origin, f.token); const second = worker(f.origin, f.token);
  try {
    const pending = first.call(); await f.dispatch;
    const refused = await second.call();
    expect(refused.status).toBe(403); expect(refused.body).toContain('operation-pending');
    f.release(); const completed = await pending;
    expect(completed.status).toBe(200);
    const retried = await second.call();
    expect(retried).toEqual(completed);
    expect(f.upstreamCalls).toHaveLength(1);
    expect(f.owner.ledger.budgetState('grant', f.owner.grant.id).spent.tokens).toBe(2);
  } finally { await Promise.all([stop(first.child), stop(second.child)]); await f.close(); }
}, 15_000);

it('an unsupported-idempotency provider losing acknowledgement keeps the hold and routes reconciliation to its owner', async () => {
  const f = await organizationGatewayFixture({ idempotency: false }); f.setMode('lost-ack');
  try {
    const first = await f.call(); expect(first.status).toBe(503); await first.body?.cancel();
    const retry = await f.call(); expect(retry.status).toBe(503); expect(await retry.text()).toContain('outcome-unknown');
    expect(f.upstreamCalls).toHaveLength(1); expect(f.upstreamCalls[0]!.key).toBeUndefined();
    expect(f.owner.ledger.budgetState('grant', f.owner.grant.id).held.tokens).toBe(10);
    const incident = f.incidents.find((event) => event.kind === 'unknown-effect');
    expect(incident?.resources).toEqual(['model']); expect(incident?.operationDigest).toMatch(/^[a-f0-9]{64}$/u);
    const request = await f.payloads.operation(f.owner.grant.id, incident!.operationDigest!);
    await f.control.stopGrant(f.owner.grant.id);
    const confirmed = await f.control.reconcileExternalOperation(request, { confirm: async (digest) => {
      expect(digest).toBe(incident!.operationDigest);
      return { assetOwnerConfirmed: true };
    } });
    expect(confirmed.usage.tokens).toBe(10);
    expect(f.owner.ledger.budgetState('grant', f.owner.grant.id).held.tokens).toBe(0);
    expect(f.owner.ledger.budgetState('grant', f.owner.grant.id).spent.tokens).toBe(10);
    expect(() => f.owner.ledger.currentGrant(f.owner.grant.id)).toThrow(/revoked/u);
  } finally { await f.close(); }
});

it('worker crash after dispatch retains the reservation and another worker cannot retry the uncertain effect', async () => {
  const f = await organizationGatewayFixture(); f.setMode('pending');
  const first = worker(f.origin, f.token); const second = worker(f.origin, f.token);
  try {
    void first.call(); await f.dispatch; await stop(first.child);
    await f.unknown;
    const retry = await second.call(); expect(retry.status).toBe(503); expect(retry.body).toContain('outcome-unknown');
    expect(f.upstreamCalls).toHaveLength(1);
    expect(f.owner.ledger.budgetState('grant', f.owner.grant.id).held.tokens).toBe(10);
  } finally { await Promise.all([stop(first.child), stop(second.child)]); await f.close(); }
}, 15_000);

it('owner withdrawal destroys the active client connection and withholds later admission', async () => {
  const f = await organizationGatewayFixture(); f.setMode('pending');
  const active = worker(f.origin, f.token);
  try {
    const pending = active.call(); await f.dispatch;
    await f.control.stopGrant(f.owner.grant.id);
    expect((await pending).status).toBe(0);
    expect(f.terminations).toEqual([f.config.worker.resource]);
    const refused = await f.call('after-stop'); expect(refused.status).toBe(403); await refused.body?.cancel();
    expect(f.owner.ledger.budgetState('grant', f.owner.grant.id).held.tokens).toBe(10);
  } finally { await stop(active.child); await f.close(); }
}, 15_000);

it('input plus maximum output exceeding the reserved budget refuses before provider generation', async () => {
  const f = await organizationGatewayFixture(); f.setInputTokens(9);
  try {
    const response = await f.call(); expect(response.status).toBe(403); expect(await response.text()).toContain('budget-exhausted');
    expect(f.upstreamCalls).toHaveLength(0);
    expect(f.owner.ledger.budgetState('grant', f.owner.grant.id).held.tokens).toBe(0);
    expect(f.a.entries.map((entry) => entry.event.phase)).toEqual(['dispatch', 'refused']);
  } finally { await f.close(); }
});
