import { createServer } from 'node:http';
import { sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrganizationAudit, OrganizationFileLedgerAnchor } from '@robota-sdk/agent-organization';
import { organizationOwnerAuditFixture, organizationOwnerFixture } from './organization-owner-fixture.js';
import { HostedOrganizationControl } from '../hosted-organization-control.js';
import { HostedOrganizationPayloads } from '../hosted-organization-payloads.js';
import { createHostedOrganizationModelAction } from '../hosted-organization-model.js';
import { createHostedOrganizationInputTokenCounter } from '../hosted-organization-token-counter.js';
import { createHostedOrganizationGateway } from '../hosted-organization-gateway.js';
import type { IHostedRuntimeConfig } from '../hosted-runtime-types.js';

export async function organizationGatewayFixture(options: { idempotency?: boolean; timeMs?: number } = {}) {
  let handler: ReturnType<typeof createHostedOrganizationGateway> | undefined;
  const ingress = createServer((request, response) => { if (handler) handler(request, response); else response.writeHead(503).end(); });
  await new Promise<void>((resolve) => ingress.listen(0, '127.0.0.1', resolve));
  const address = ingress.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  const origin = `http://127.0.0.1:${address.port}`;
  const custody = mkdtempSync(join(tmpdir(), 'company-anchor-'));
  const content = mkdtempSync(join(tmpdir(), 'company-content-'));
  const owner = organizationOwnerFixture(new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'company' }), { audience: origin, modelResource: 'model' });
  const a = organizationOwnerAuditFixture();
  const incidents: Array<{ kind: string; resources: readonly string[]; operationDigest?: string }> = []; const terminations: string[] = [];
  let unknownResolved!: () => void;
  const unknown = new Promise<void>((resolve) => { unknownResolved = resolve; });
  let mode: 'complete' | 'lost-ack' | 'pending' = 'complete';
  let inputTokens = 1;
  let dispatched!: () => void;
  const dispatch = new Promise<void>((resolve) => { dispatched = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const upstreamCalls: Array<{ key: string | undefined; body: unknown }> = [];
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
    if (request.url === '/count') { response.end(JSON.stringify({ input_tokens: inputTokens })); return; }
    upstreamCalls.push({ key: request.headers['idempotency-key'] as string | undefined, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    dispatched();
    if (mode === 'lost-ack') { response.destroy(); return; }
    if (mode === 'pending') await blocked;
    if (response.destroyed) return;
    response.end(JSON.stringify({ id: 'completion', object: 'chat.completion', created: 0, model: 'pinned-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'COMPANY_EFFECT' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddress = upstream.address(); if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('missing upstream');
  const provider = `http://127.0.0.1:${upstreamAddress.port}`;
  const payloads = await HostedOrganizationPayloads.open(content);
  const config: IHostedRuntimeConfig = { version: 3, identity: { tenant: owner.grant.tenant, task: owner.grant.task, rootTask: owner.grant.id, actor: owner.grant.actor, runtime: 'runtime' }, epoch: owner.grant.epoch,
    worker: { resource: 'provider-worker', endpoint: `${origin}/worker`, publicKey: owner.issuer.publicKey },
    broker: { resource: 'company-broker', endpoint: `${origin}/broker`, publicKey: owner.issuer.publicKey }, snapshot: null, lifetimeMs: 25_000, probeTimeoutMs: 1000,
    limits: { sessions: 1, modelCalls: 100, modelTokens: 100, costMicros: 100 } };
  const action = createHostedOrganizationModelAction({ payloads, endpoint: `${provider}/v1`, apiKey: 'owner-upstream-only', model: 'pinned-model', roles: ['operator'], resource: 'model',
    reservation: { tokens: 10, timeMs: options.timeMs ?? 20_000, costMicros: 10 }, maxInputBytes: 4096, maxOutputTokens: 8, costMicrosPerToken: 1, providerIdempotency: options.idempotency ?? true,
    countInputTokens: createHostedOrganizationInputTokenCounter({ endpoint: `${provider}/count`, apiKey: 'owner-counter-only', encode: (_surface, body) => body }) });
  const control = new HostedOrganizationControl({ ledger: owner.ledger, audit: new OrganizationAudit({ stream: a.stream, publicKey: a.signer.publicKey, sink: a.sink, anchor: a.anchor }), actions: [action],
    inventory: { list: async () => terminations.length ? [] : [{ resource: config.worker.resource, grantId: owner.grant.id, identity: config.identity, epoch: config.epoch }], terminate: async (worker) => { terminations.push(worker.resource); } },
    incidentOwners: { detection: 'security', containment: 'runtime', assessment: 'asset-owner', recovery: 'authority-owner', report: async (event) => { incidents.push(event); if (event.kind === 'unknown-effect') unknownResolved(); } } });
  const token = 'task-bearer-'.padEnd(48, 'x');
  handler = createHostedOrganizationGateway({ control, ledger: owner.ledger, payloads, modelResource: 'model', bindings: [{ config, grantId: owner.grant.id, token, expiresAt: Date.now() + 60_000,
    signAdmission: (_role, bytes) => sign(null, bytes, owner.issuer.privateKey).toString('base64url'), signRequest: (bytes) => sign(null, bytes, owner.worker.privateKey).toString('base64url') }] });
  return { owner, a, control, config, token, origin, content, payloads, upstreamCalls, dispatch, unknown, incidents, terminations,
    setMode: (next: typeof mode) => { mode = next; }, setInputTokens: (next: number) => { inputTokens = next; }, release,
    async call(key = 'duplicate') {
      return fetch(`${origin}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ model: 'pinned-model', stream: false, messages: [{ role: 'user', content: 'same effect' }] }) });
    },
    async close() {
      release(); await control.close(); ingress.closeAllConnections(); upstream.closeAllConnections();
      await Promise.all([new Promise<void>((resolve) => ingress.close(() => resolve())), new Promise<void>((resolve) => upstream.close(() => resolve()))]);
      owner.cleanup(); rmSync(custody, { recursive: true, force: true }); rmSync(content, { recursive: true, force: true });
    },
  };
}
