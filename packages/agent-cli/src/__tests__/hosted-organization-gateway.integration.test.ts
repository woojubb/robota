import { createServer } from 'node:http';
import { sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { OrganizationAudit, OrganizationFileLedgerAnchor } from '@robota-sdk/agent-organization-host';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { organizationOwnerAuditFixture, organizationOwnerFixture } from '../hosted/__tests__/organization-owner-fixture.js';
import { HostedOrganizationControl } from '../hosted/hosted-organization-control.js';
import { HostedOrganizationPayloads } from '../hosted/hosted-organization-payloads.js';
import { createHostedOrganizationModelAction } from '../hosted/hosted-organization-model.js';
import { createHostedOrganizationGateway } from '../hosted/hosted-organization-gateway.js';
import { createHostedOrganizationInputTokenCounter } from '../hosted/hosted-organization-token-counter.js';

it.each(['chat-completions', 'responses'] as const)('runs the stock hosted worker through durable company admission, HTTP provider, audit and final accounting: %s', async (apiSurface) => {
  const token = 'task-only-credential-'.padEnd(48, 'x');
  const fixture = await hostedWorkerCliFixture({ providers: { openai: {
    type: 'openai', model: 'gpt-test', apiKey: '$ENV:OPENAI_API_KEY', options: { durableOperations: true, apiSurface },
  } } }, { taskToken: token });
  const custody = mkdtempSync(join(tmpdir(), 'company-anchor-'));
  const content = mkdtempSync(join(tmpdir(), 'company-payload-'));
  const config = fixture.f.config;
  const owner = organizationOwnerFixture(new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'company' }), {
    audience: new URL(config.broker.endpoint).origin, grantId: config.identity.rootTask,
    tenant: config.identity.tenant, task: config.identity.task, actor: config.identity.actor,
    epoch: config.epoch, modelResource: 'model',
  });
  const a = organizationOwnerAuditFixture();
  const upstreamCalls: Array<{ key: string | undefined; authorization: string | undefined; body: Record<string, unknown> }> = [];
  const countedBodies: Record<string, unknown>[] = [];
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
    if (request.url === '/v1/count') {
      countedBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.end(JSON.stringify({ input_tokens: 1 })); return;
    }
    upstreamCalls.push({ key: request.headers['idempotency-key'] as string | undefined, authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/v1/responses' ? {
      id: 'r1', object: 'response', status: 'completed', created_at: 0, model: 'gpt-test',
      output: [{ id: 'm1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'DURABLE_COMPANY_REPLY', annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    } : { id: 'c1', object: 'chat.completion', created: 0, model: 'gpt-test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'DURABLE_COMPANY_REPLY' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address(); if (!address || typeof address === 'string') throw new Error('no address');
  const payloads = await HostedOrganizationPayloads.open(content);
  const audit = new OrganizationAudit({ stream: a.stream, publicKey: a.signer.publicKey, sink: a.sink, anchor: a.anchor });
  const action = createHostedOrganizationModelAction({ payloads, endpoint: `http://127.0.0.1:${address.port}/v1`,
    apiKey: 'private-upstream-canary', model: 'gpt-test', roles: ['operator'], resource: 'model',
    reservation: { tokens: 10, timeMs: 25_000, costMicros: 10 }, maxInputBytes: 1024 * 1024, maxOutputTokens: 8, costMicrosPerToken: 1, providerIdempotency: true,
    countInputTokens: createHostedOrganizationInputTokenCounter({ endpoint: `http://127.0.0.1:${address.port}/v1/count`, apiKey: 'private-upstream-canary', encode: (_surface, body) => body }),
  });
  const control = new HostedOrganizationControl({ ledger: owner.ledger, audit, actions: [action],
    inventory: { list: async () => [{ resource: config.worker.resource, grantId: owner.grant.id, identity: config.identity, epoch: config.epoch }], terminate: async () => undefined },
    incidentOwners: { detection: 'security', containment: 'runtime', assessment: 'asset-owner', recovery: 'authority-owner', report: async () => undefined } });
  const gateway = createHostedOrganizationGateway({ control, ledger: owner.ledger, payloads, modelResource: 'model', bindings: [{
    config, grantId: owner.grant.id, token, expiresAt: Date.now() + 60_000,
    signAdmission: (_role, bytes) => fixture.f.signAdmissionBytes(bytes),
    signRequest: (bytes) => sign(null, bytes, owner.worker.privateKey).toString('base64url'),
  }] });
  fixture.f.setAdmissionHandler(gateway);
  fixture.f.setModelHandler(async (request, response) => { gateway(request, response); });
  try {
    const result = await fixture.run(['-p', 'Return the company response', '--max-turns', '3', '--no-session-persistence']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('DURABLE_COMPANY_REPLY');
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]!.key).toMatch(/^[a-f0-9]{64}$/u);
    expect(upstreamCalls[0]!.authorization).toBe('Bearer private-upstream-canary');
    expect(upstreamCalls[0]!.body.stream).toBe(false);
    expect(countedBodies).toEqual([upstreamCalls[0]!.body]);
    expect(owner.ledger.budgetState('grant', owner.grant.id).spent.tokens).toBe(2);
    expect(a.entries.map((entry) => entry.event.phase)).toEqual(['dispatch', 'complete']);
    expect(JSON.stringify(a.entries)).not.toContain('private-upstream-canary');
    const status = JSON.parse(readFileSync(fixture.usageReceipt, 'utf8'));
    expect(status).toEqual({ state: 'stopped', usage: { sessions: 1, modelCalls: 1, modelTokens: 2, costMicros: 2 } });
    const processes = readFileSync(fixture.processes, 'utf8');
    expect(processes).not.toContain('private-upstream-canary');
  } finally {
    await control.close(); owner.cleanup(); await fixture.close();
    upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(custody, { recursive: true, force: true }); rmSync(content, { recursive: true, force: true });
  }
}, 60_000);
