import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { OrganizationRefused, organizationSigningBytes } from '@robota-sdk/agent-organization-host';
import type { OrganizationLedger, IOrganizationRequest, IOrganizationEnvelope } from '@robota-sdk/agent-organization-host';
import { hostedAdmissionBytes, verifyHostedAdmissionProof } from './hosted-runtime-admission.js';
import type { IHostedAdmissionProof, IHostedRuntimeConfig, IHostedRuntimeUsage, THostedBackendRole } from './hosted-runtime-types.js';
import type { HostedOrganizationControl } from './hosted-organization-control.js';
import type { HostedOrganizationPayloads } from './hosted-organization-payloads.js';

export interface IHostedOrganizationBinding {
  readonly config: IHostedRuntimeConfig;
  readonly grantId: string;
  readonly token: string;
  readonly expiresAt: number;
  /** External issuer capabilities installed by the owner, never supplied by an HTTP caller. */
  signAdmission(role: THostedBackendRole, bytes: Uint8Array): string;
  signRequest(bytes: Uint8Array): string;
}

/** Actual stock CLI admission and OpenAI-wire ingress over durable company effects. No owner routes. */
export function createHostedOrganizationGateway(options: {
  readonly control: HostedOrganizationControl;
  readonly ledger: OrganizationLedger;
  readonly payloads: HostedOrganizationPayloads;
  readonly bindings: readonly IHostedOrganizationBinding[];
  readonly modelResource: string;
}): (request: IncomingMessage, response: ServerResponse) => void {
  const bindings = [...options.bindings];
  const tokens = new Set<string>(); const runtimes = new Set<string>(); const grants = new Set<string>();
  for (const binding of bindings) {
    if (!/^[A-Za-z0-9_-]{32,256}$/u.test(binding.token) || tokens.has(binding.token) || runtimes.has(binding.config.identity.runtime) || grants.has(binding.grantId))
      throw new OrganizationRefused('invalid-schema');
    const grant = options.ledger.currentGrant(binding.grantId);
    if (grant.scopes.length !== 1 || grant.scopes[0]!.resource !== options.modelResource ||
      grant.scopes[0]!.operations.length !== 1 || grant.scopes[0]!.operations[0] !== 'generate')
      throw new OrganizationRefused('not-authorized');
    tokens.add(binding.token); runtimes.add(binding.config.identity.runtime); grants.add(binding.grantId);
  }
  const usage = (binding: IHostedOrganizationBinding): IHostedRuntimeUsage => {
    const budget = options.ledger.budgetState('grant', binding.grantId);
    return { sessions: 1, modelCalls: options.ledger.grantOperationCount(binding.grantId),
      modelTokens: budget.spent.tokens, costMicros: budget.spent.costMicros };
  };
  return (request, response) => {
    const controller = new AbortController();
    const disconnected = (): void => { if (!response.writableFinished) controller.abort(); };
    response.once('close', disconnected);
    const timeout = setTimeout(() => { controller.abort(); request.destroy(); response.destroy(); }, 30_000);
    const reply = (status: number, body: unknown): void => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    void (async () => {
      try {
        const seen = new Set<string>();
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
          const key = request.rawHeaders[index]!.toLowerCase();
          if (!['host', 'authorization', 'idempotency-key', 'content-type', 'content-length', 'transfer-encoding', 'origin'].includes(key)) continue;
          if (seen.has(key)) throw new OrganizationRefused('invalid-schema'); seen.add(key);
        }
        if (request.method !== 'POST' || request.headers.origin !== undefined || request.headers['content-type'] !== 'application/json' || request.headers['content-encoding'] !== undefined)
          throw new OrganizationRefused('not-authorized');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
          if (size > 4 * 1024 * 1024) throw new OrganizationRefused('invalid-schema'); chunks.push(bytes);
        }
        const bytes = Buffer.concat(chunks);
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>;
        if (!body || Array.isArray(body)) throw new OrganizationRefused('invalid-schema');
        const model = ['/v1/chat/completions', '/v1/responses'].includes(request.url ?? '');
        const binding = model
          ? bindings.find((entry) => request.headers.authorization === `Bearer ${entry.token}`)
          : bindings.find((entry) => (body.identity as { runtime?: unknown } | undefined)?.runtime === entry.config.identity.runtime);
        if (!binding || binding.expiresAt <= Date.now()) throw new OrganizationRefused('expired');
        const config = binding.config;
        if (request.headers.host !== new URL(config.broker.endpoint).host ||
          new URL(config.worker.endpoint).origin !== new URL(config.broker.endpoint).origin)
          throw new OrganizationRefused('not-authorized');
        const grant = await options.control.admit({ resource: config.worker.resource, grantId: binding.grantId, identity: config.identity, epoch: config.epoch }, controller.signal);
        if (!model) {
          const role = request.url === new URL(config.worker.endpoint).pathname ? 'worker'
            : request.url === new URL(config.broker.endpoint).pathname ? 'broker' : undefined;
          if (!role || typeof body.nonce !== 'string' || body.version !== 3 || body.role !== role ||
            body.resource !== config[role].resource || body.epoch !== config.epoch ||
            Object.entries(config.identity).some(([key, expected]) => (body.identity as Record<string, unknown>)?.[key] !== expected) ||
            JSON.stringify(body.snapshot) !== JSON.stringify(config.snapshot) || JSON.stringify(body.limits) !== JSON.stringify(config.limits))
            throw new OrganizationRefused('not-authorized');
          const issuedAt = Date.now();
          const unsigned: Omit<IHostedAdmissionProof, 'signature'> = { version: 3, identity: config.identity, role, resource: config[role].resource, nonce: body.nonce, epoch: config.epoch, issuedAt,
            expiresAt: Math.min(issuedAt + 60_000, binding.expiresAt, grant.expiresAt), snapshot: config.snapshot, ready: true, limits: config.limits, usage: role === 'broker' ? usage(binding) : null };
          const proof = { ...unsigned, signature: binding.signAdmission(role, hostedAdmissionBytes(unsigned)) };
          verifyHostedAdmissionProof(proof, config, role, body.nonce, Date.now());
          reply(200, proof); return;
        }
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(key)) throw new OrganizationRefused('invalid-schema');
        const payload = await options.payloads.put(grant.id, bytes);
        const now = Date.now();
        const claims: IOrganizationRequest = { version: 1, grantId: grant.id, tenant: grant.tenant, task: grant.task, actor: grant.actor, audience: grant.audience, epoch: grant.epoch, nonce: randomUUID(), notBefore: now,
          expiresAt: Math.min(now + 25_000, binding.expiresAt, grant.expiresAt), operation: { idempotencyKey: key, resource: options.modelResource, operation: 'generate', environment: 'hosted', parameters: { request: payload, surface: request.url === '/v1/responses' ? 'responses' : 'chat-completions' } } };
        const envelope: IOrganizationEnvelope<IOrganizationRequest> = { claims, signature: binding.signRequest(organizationSigningBytes('request', claims)) };
        await options.payloads.recordOperation(claims);
        const receipt = await options.control.apply({ request: envelope, approval: null }, controller.signal, () => response.destroy());
        const digest = (receipt.value as { response?: unknown } | null)?.response;
        if (typeof digest !== 'string') throw new OrganizationRefused('outcome-unknown');
        const returned = await options.payloads.get(grant.id, digest);
        const result = JSON.parse(returned.toString('utf8')) as Record<string, unknown>;
        if (body.stream === true) {
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
          if (request.url === '/v1/responses') {
            const output = result.output as Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
            if (Array.isArray(output)) for (const item of output) {
              if (item.type === 'message' && Array.isArray(item.content)) for (const part of item.content) {
                if (part.type === 'output_text' && typeof part.text === 'string')
                  response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: part.text })}\n\n`);
              }
            }
            response.end(`data: ${JSON.stringify({ type: 'response.completed', response: result })}\n\n`);
          }
          else {
            const choices = result.choices as Array<{ index: number; message: Record<string, unknown>; finish_reason: unknown }>;
            if (!Array.isArray(choices)) throw new OrganizationRefused('outcome-unknown');
            response.write(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: choices.map((choice) => ({ index: choice.index, delta: { ...choice.message,
              ...(Array.isArray(choice.message.tool_calls) ? { tool_calls: choice.message.tool_calls.map((tool, index) => ({ ...tool as object, index })) } : {}) }, finish_reason: null })) })}\n\n`);
            response.end(`data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: choices.map((choice) => ({ index: choice.index, delta: {}, finish_reason: choice.finish_reason })) })}\n\ndata: [DONE]\n\n`);
          }
        } else reply(200, result);
      } catch (error) {
        if (response.headersSent) response.destroy();
        else reply(error instanceof OrganizationRefused && ['policy-unavailable', 'outcome-unknown'].includes(error.reason) ? 503 : 403,
          { error: { message: error instanceof OrganizationRefused ? error.message : 'Organization ingress refused', type: 'organization_refusal' } });
        request.resume();
      } finally { clearTimeout(timeout); response.removeListener('close', disconnected); }
    })();
  };
}
