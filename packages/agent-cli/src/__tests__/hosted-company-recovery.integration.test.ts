import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Sandbox } from 'e2b/dist/index.mjs';
import { expect, it, vi } from 'vitest';
import { OrganizationAudit, OrganizationFileLedgerAnchor } from '@robota-sdk/agent-organization';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { organizationOwnerAuditFixture, organizationOwnerFixture, signed } from '../hosted/__tests__/organization-owner-fixture.js';
import { provisionE2BTaskWorker } from '../hosted/e2b-worker-provisioning.js';
import { HostedOrganizationControl } from '../hosted/hosted-organization-control.js';
import { HostedOrganizationPayloads } from '../hosted/hosted-organization-payloads.js';
import { createHostedOrganizationModelAction } from '../hosted/hosted-organization-model.js';
import { createHostedOrganizationInputTokenCounter } from '../hosted/hosted-organization-token-counter.js';
import { createHostedOrganizationGateway } from '../hosted/hosted-organization-gateway.js';

it('revokes old authority, restores task files through the stock CLI, and uses fresh workload credentials under current accounting', async () => {
  const token = 'fresh-task-only-'.padEnd(48, 'x');
  const fixture = await hostedWorkerCliFixture({ providers: { openai: { type: 'openai', model: 'gpt-test', apiKey: '$ENV:OPENAI_API_KEY', options: { durableOperations: true, apiSurface: 'chat-completions' } } } }, { taskToken: token });
  const custody = mkdtempSync(join(tmpdir(), 'recovery-authority-'));
  const content = mkdtempSync(join(tmpdir(), 'recovery-payload-'));
  const original = fixture.f.config;
  const owner = organizationOwnerFixture(new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'company' }), { audience: new URL(original.broker.endpoint).origin,
    tenant: original.identity.tenant, task: original.identity.task, actor: 'revoked-actor', grantId: 'old-workload', epoch: 2, modelResource: 'model' });
  const previous = owner.request({ operation: { idempotencyKey: 'previous', resource: 'model', operation: 'generate', environment: 'hosted', parameters: 'previous-owned-effect' } });
  owner.ledger.reserve(owner.call(previous).request, { tokens: 10, timeMs: 1000, costMicros: 10 }, null, false);
  owner.ledger.settle(previous, { value: 'previous-result', usage: { tokens: 2, timeMs: 1, costMicros: 2 } });
  owner.ledger.revokeGrant(owner.grant.id); owner.ledger.advanceEpoch(original.epoch);
  const fresh = generateKeyPairSync('ed25519');
  const grant = { ...owner.grant, id: 'fresh-workload', actor: original.identity.actor, epoch: original.epoch, publicKey: fresh.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
  owner.ledger.registerGrant(signed('workload', grant, owner.issuer.privateKey));
  expect(() => owner.ledger.authenticate(owner.call(owner.request()).request)).toThrow(/revoked/u);
  const checkpoint = Buffer.from(JSON.stringify({ version: 1, id: 'saved-task-files', identity: { ...original.identity, actor: 'revoked-actor', runtime: 'old-runtime' }, epoch: 2, worker: 'old-worker',
    files: [{ path: 'recovered.txt', base64: Buffer.from('RECOVERED_COMPANY_TASK').toString('base64') }] }));
  const snapshot = { id: 'saved-task-files', digest: createHash('sha256').update(checkpoint).digest('hex') };
  let workspace: string | undefined;
  const info = JSON.parse(readFileSync(fixture.providerInfo, 'utf8')) as Record<string, unknown>;
  vi.spyOn(Sandbox, 'create').mockImplementation(async (_template, options) => {
    info.metadata = options!.metadata;
    return { sandboxId: original.worker.resource, commands: { run: async (command: string) => {
      const stdout = execFileSync('/bin/sh', ['-c', command], { cwd: '/', env: { TMPDIR: fixture.f.directory }, encoding: 'utf8' }); workspace = stdout.trim(); return { exitCode: 0, stdout, stderr: '' };
    } }, files: { write: async (path: string, bytes: ArrayBuffer | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes instanceof ArrayBuffer ? Buffer.from(bytes) : bytes); }, read: async (path: string) => readFileSync(path) } } as unknown as Sandbox;
  });
  vi.spyOn(Sandbox, 'getInfo').mockImplementation(async () => info as unknown as Awaited<ReturnType<typeof Sandbox.getInfo>>);
  vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
  let control: HostedOrganizationControl | undefined;
  let upstream: ReturnType<typeof createServer> | undefined;
  try {
    const worker = await provisionE2BTaskWorker({ identity: original.identity, epoch: original.epoch, templateId: 'fixture-template', apiKey: 'private-management-canary', brokerEndpoint: original.broker.endpoint,
      lifetimeMs: 55_000, requestTimeoutMs: 1000, signal: new AbortController().signal, snapshot, checkpoint, organization: { controlPlane: 'company', grantId: grant.id } });
    writeFileSync(fixture.providerInfo, JSON.stringify(info));
    const config = { ...original, snapshot, lifetimeMs: 55_000 };
    fixture.f.writeConfig(config);
    const execution = JSON.parse(readFileSync(fixture.execution, 'utf8')) as Record<string, unknown>;
    writeFileSync(fixture.execution, JSON.stringify({ ...execution, workspaceRoot: worker.workspaceRoot }));
    const calls: Record<string, unknown>[] = [];
    upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
      if (request.url === '/count') { response.end(JSON.stringify({ input_tokens: 1 })); return; }
      calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const first = calls.length === 1;
      response.end(JSON.stringify({ id: `reply-${calls.length}`, object: 'chat.completion', created: 0, model: 'gpt-test',
        choices: [{ index: 0, message: first ? { role: 'assistant', content: null, tool_calls: [{ id: 'read-recovered', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ filePath: join(worker.workspaceRoot, 'recovered.txt') }) } }] } : { role: 'assistant', content: 'FRESH_COMPANY_RECOVERY_COMPLETE' }, finish_reason: first ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve));
    const address = upstream.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const endpoint = `http://127.0.0.1:${address.port}`;
    const payloads = await HostedOrganizationPayloads.open(content);
    const a = organizationOwnerAuditFixture();
    const action = createHostedOrganizationModelAction({ payloads, endpoint, apiKey: 'private-provider-canary', model: 'gpt-test', roles: ['operator'], resource: 'model', reservation: { tokens: 10, timeMs: 25_000, costMicros: 10 },
      maxInputBytes: 1024 * 1024, maxOutputTokens: 8, costMicrosPerToken: 1, providerIdempotency: false, countInputTokens: createHostedOrganizationInputTokenCounter({ endpoint: `${endpoint}/count`, apiKey: 'private-counter-canary', encode: (_surface, body) => body }) });
    control = new HostedOrganizationControl({ ledger: owner.ledger, audit: new OrganizationAudit({ stream: a.stream, publicKey: a.signer.publicKey, sink: a.sink, anchor: a.anchor }), actions: [action],
      inventory: { list: async () => [{ resource: worker.resource, grantId: grant.id, identity: original.identity, epoch: original.epoch }], terminate: async () => undefined },
      incidentOwners: { detection: 'security', containment: 'runtime', assessment: 'asset-owner', recovery: 'authority-owner', report: async () => undefined } });
    const gateway = createHostedOrganizationGateway({ control, ledger: owner.ledger, payloads, modelResource: 'model', bindings: [{ config, grantId: grant.id, token, expiresAt: Date.now() + 60_000,
      signAdmission: (_role, bytes) => fixture.f.signAdmissionBytes(bytes), signRequest: (bytes) => sign(null, bytes, fresh.privateKey).toString('base64url') }] });
    fixture.f.setAdmissionHandler(gateway); fixture.f.setModelHandler(async (request, response) => { gateway(request, response); });
    const stale = await fetch(new URL('/v1/chat/completions', original.broker.endpoint), { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer old-revoked-credential'.padEnd(55, 'x'), 'idempotency-key': 'old' }, body: JSON.stringify({ model: 'gpt-test' }) });
    expect(stale.status).toBe(403); await stale.body?.cancel();
    const result = await fixture.run(['-p', 'Read the recovered company task', '--permission-mode', 'bypassPermissions', '--no-session-persistence', '--max-turns', '3']);
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('FRESH_COMPANY_RECOVERY_COMPLETE');
    expect(JSON.stringify(calls[1])).toContain('RECOVERED_COMPANY_TASK');
    expect(owner.ledger.budgetState('global').spent.tokens).toBe(6);
    expect(owner.ledger.budgetState('grant', owner.grant.id).spent.tokens).toBe(2);
    expect(owner.ledger.budgetState('grant', grant.id).spent.tokens).toBe(4);
    const processes = readFileSync(fixture.processes, 'utf8');
    expect(processes).not.toContain('private-provider-canary'); expect(processes).not.toContain('private-management-canary');
  } finally {
    vi.restoreAllMocks(); await control?.close(); owner.cleanup(); await fixture.close();
    if (upstream) { upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream!.close(() => resolve())); }
    if (workspace) rmSync(workspace, { recursive: true, force: true }); rmSync(custody, { recursive: true, force: true }); rmSync(content, { recursive: true, force: true });
  }
}, 60_000);
