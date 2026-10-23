import { createServer } from 'node:http';
import { sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createAgentSystemCommand } from '@robota-sdk/agent-command';
import { createProviderSafeModelCommandToolName } from '@robota-sdk/agent-framework';
import {
  OrganizationAudit,
  OrganizationFileLedgerAnchor,
} from '@robota-sdk/agent-organization-host';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { createTestProductEnvironment } from './helpers/product-runtime.js';
import { resolveCliRuntimeContext } from '../startup/product-bootstrap.js';
import {
  organizationOwnerAuditFixture,
  organizationOwnerFixture,
} from '../hosted/__tests__/organization-owner-fixture.js';
import { HostedOrganizationControl } from '../hosted/hosted-organization-control.js';
import { HostedOrganizationPayloads } from '../hosted/hosted-organization-payloads.js';
import { createHostedOrganizationModelAction } from '../hosted/hosted-organization-model.js';
import { createHostedOrganizationGateway } from '../hosted/hosted-organization-gateway.js';
import { createHostedOrganizationInputTokenCounter } from '../hosted/hosted-organization-token-counter.js';

const chatRequest = z
  .object({
    messages: z.array(
      z
        .object({ role: z.string(), content: z.unknown(), tool_call_id: z.string().optional() })
        .passthrough(),
    ),
    tools: z.array(
      z
        .object({
          function: z
            .object({ name: z.string(), description: z.string().optional() })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const toolResult = z.object({ success: z.literal(true) }).passthrough();
const startedGroup = toolResult.extend({
  data: z.object({ groupId: z.string().min(1), agentIds: z.tuple([z.string().min(1)]) }),
});
const completedGroup = toolResult.extend({
  data: z.object({
    groupId: z.string(),
    summary: z.object({
      status: z.literal('completed'),
      total: z.literal(1),
      completed: z.literal(1),
      failed: z.literal(0),
      cancelled: z.literal(0),
      pending: z.literal(0),
      lines: z.array(z.string()).length(1),
    }),
  }),
});
const processRecord = z.object({
  pid: z.number(),
  ppid: z.number(),
  ipc: z.boolean(),
  cwd: z.string(),
  environment: z.record(z.string()),
});

it('accounts a public child process and its parent under the inherited hosted model grant', async () => {
  const token = 'public-child-task-only-credential-'.padEnd(48, 'x');
  const fixture = await hostedWorkerCliFixture(
    {
      providers: {
        openai: {
          type: 'openai',
          model: 'gpt-test',
          apiKey: '$ENV:OPENAI_API_KEY',
          options: { durableOperations: true, apiSurface: 'chat-completions' },
        },
      },
      permissions: { allow: ['Read', 'Write'] },
    },
    { taskToken: token },
  );
  const custody = mkdtempSync(join(tmpdir(), 'public-child-anchor-'));
  const content = mkdtempSync(join(tmpdir(), 'public-child-payload-'));
  const target = join(fixture.worker, 'public-child.txt');
  writeFileSync(target, 'before-public-child');
  const command = createAgentSystemCommand();
  expect(command.semanticRole).toBe('subagentSpawn');
  const spawnTool = createProviderSafeModelCommandToolName(
    command.name,
    createTestProductEnvironment().PRODUCT_MODEL_TOOL_PREFIX,
  );
  const config = fixture.f.config;
  const owner = organizationOwnerFixture(
    new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'company' }),
    {
      audience: new URL(config.broker.endpoint).origin,
      grantId: config.identity.rootTask,
      tenant: config.identity.tenant,
      task: config.identity.task,
      actor: config.identity.actor,
      epoch: config.epoch,
      modelResource: 'model',
    },
  );
  const a = organizationOwnerAuditFixture();
  const calls: Array<{
    key: string | undefined;
    authorization: string | undefined;
    body: z.infer<typeof chatRequest>;
  }> = [];
  const countedBodies: unknown[] = [];
  const stages: string[] = [];
  const failures: string[] = [];
  let group: z.infer<typeof startedGroup>['data'] | undefined;
  const upstream = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.setHeader('content-type', 'application/json');
      expect(request.headers.authorization).toBe('Bearer private-upstream-canary');
      if (request.url === '/v1/count') {
        countedBodies.push(body);
        response.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      expect(request.url).toBe('/v1/chat/completions');
      const chat = chatRequest.parse(body);
      const key = request.headers['idempotency-key'];
      if (key !== undefined && typeof key !== 'string')
        throw new Error('invalid idempotency header');
      calls.push({ key, authorization: request.headers.authorization, body: chat });
      const users = chat.messages.filter((message) => message.role === 'user');
      const isChild = users.some(
        (message) =>
          typeof message.content === 'string' &&
          message.content.startsWith('CHILD_PUBLIC_CHILD_PROBE:'),
      );
      const results = chat.messages.filter((message) => message.role === 'tool');
      const stage = `${isChild ? 'child' : 'parent'}:${results.length}`;
      expect(stages).not.toContain(stage);
      stages.push(stage);
      const names = chat.tools.map((tool) => tool.function.name);
      let answer: {
        role: 'assistant';
        content: string | null;
        tool_calls?: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }>;
      };
      const invoke = (name: string, args: Record<string, string>) => ({
        role: 'assistant' as const,
        content: null,
        tool_calls: [
          {
            id: `call-${stage}`,
            type: 'function' as const,
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
      const resultAt = (index: number): unknown => {
        const result = results[index];
        if (!result || typeof result.content !== 'string')
          throw new Error(`missing tool result ${stage}:${index}`);
        return JSON.parse(result.content);
      };
      if (isChild) {
        expect(names).toEqual(expect.arrayContaining(['Read', 'Write']));
        expect(names).not.toContain(spawnTool);
        expect(names).not.toContain('Agent');
        switch (results.length) {
          case 0:
            answer = invoke('Read', { filePath: target });
            break;
          case 1:
            expect(toolResult.parse(resultAt(0))).toEqual(
              expect.objectContaining({ output: expect.stringContaining('before-public-child') }),
            );
            answer = invoke('Write', { filePath: target, content: 'after-public-child' });
            break;
          case 2:
            toolResult.parse(resultAt(1));
            expect(readFileSync(target, 'utf8')).toBe('after-public-child');
            answer = { role: 'assistant', content: 'CHILD_PUBLIC_CHILD_DONE' };
            break;
          default:
            throw new Error(`unexpected child stage ${stage}`);
        }
      } else {
        expect(
          users.some(
            (message) =>
              typeof message.content === 'string' &&
              message.content.startsWith('PARENT_PUBLIC_CHILD_PROBE:'),
          ),
        ).toBe(true);
        expect(names).toContain(spawnTool);
        expect(
          chat.tools.find((tool) => tool.function.name === spawnTool)?.function.description,
        ).toContain(command.description);
        switch (results.length) {
          case 0:
            answer = invoke(spawnTool, {
              args: `parallel --detach --isolation none child:"CHILD_PUBLIC_CHILD_PROBE: read then overwrite ${target} and report CHILD_PUBLIC_CHILD_DONE"`,
            });
            break;
          case 1:
            group = startedGroup.parse(resultAt(0)).data;
            answer = invoke(spawnTool, { args: `wait ${group.groupId}` });
            break;
          case 2: {
            const completed = completedGroup.parse(resultAt(1)).data;
            expect(group).toBeDefined();
            expect(completed.groupId).toBe(group?.groupId);
            expect(completed.summary.lines[0]).toContain(group?.agentIds[0]);
            expect(completed.summary.lines[0]).toContain('CHILD_PUBLIC_CHILD_DONE');
            answer = { role: 'assistant', content: 'PARENT_PUBLIC_CHILD_DONE' };
            break;
          }
          default:
            throw new Error(`unexpected parent stage ${stage}`);
        }
      }
      response.end(
        JSON.stringify({
          id: `completion-${stage}`,
          object: 'chat.completion',
          created: 0,
          model: 'gpt-test',
          choices: [
            { index: 0, message: answer, finish_reason: answer.tool_calls ? 'tool_calls' : 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    } catch (error) {
      failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
      response.statusCode = 500;
      response.end(JSON.stringify({ error: { message: 'unexpected public child probe stage' } }));
    }
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const payloads = await HostedOrganizationPayloads.open(content);
  const audit = new OrganizationAudit({
    stream: a.stream,
    publicKey: a.signer.publicKey,
    sink: a.sink,
    anchor: a.anchor,
  });
  const upstreamEndpoint = `http://127.0.0.1:${address.port}/v1`;
  const action = createHostedOrganizationModelAction({
    payloads,
    endpoint: upstreamEndpoint,
    apiKey: 'private-upstream-canary',
    model: 'gpt-test',
    roles: ['operator'],
    resource: 'model',
    reservation: { tokens: 10, timeMs: 25_000, costMicros: 10 },
    maxInputBytes: 1024 * 1024,
    maxOutputTokens: 8,
    costMicrosPerToken: 1,
    providerIdempotency: true,
    countInputTokens: createHostedOrganizationInputTokenCounter({
      endpoint: `${upstreamEndpoint}/count`,
      apiKey: 'private-upstream-canary',
      encode: (_surface, body) => body,
    }),
  });
  const incidents: unknown[] = [];
  const control = new HostedOrganizationControl({
    ledger: owner.ledger,
    audit,
    actions: [action],
    inventory: {
      list: async () => [
        {
          resource: config.worker.resource,
          grantId: owner.grant.id,
          identity: config.identity,
          epoch: config.epoch,
        },
      ],
      terminate: async () => undefined,
    },
    incidentOwners: {
      detection: 'security',
      containment: 'runtime',
      assessment: 'asset-owner',
      recovery: 'authority-owner',
      report: async (incident) => {
        incidents.push(incident);
      },
    },
  });
  const gateway = createHostedOrganizationGateway({
    control,
    ledger: owner.ledger,
    payloads,
    modelResource: 'model',
    bindings: [
      {
        config,
        grantId: owner.grant.id,
        token,
        expiresAt: Date.now() + 60_000,
        signAdmission: (_role, bytes) => fixture.f.signAdmissionBytes(bytes),
        signRequest: (bytes) => sign(null, bytes, owner.worker.privateKey).toString('base64url'),
      },
    ],
  });
  fixture.f.setAdmissionHandler(gateway);
  fixture.f.setModelHandler(async (request, response) => {
    gateway(request, response);
  });
  try {
    const result = await fixture.run([
      '-p',
      'PARENT_PUBLIC_CHILD_PROBE: delegate one child and wait for its result',
      '--permission-mode',
      'bypassPermissions',
      '--no-session-persistence',
      '--max-turns',
      '8',
    ]);
    expect(failures, `${result.stdout}\n${result.stderr}`).toEqual([]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('PARENT_PUBLIC_CHILD_DONE');
    expect(stages.sort()).toEqual([
      'child:0',
      'child:1',
      'child:2',
      'parent:0',
      'parent:1',
      'parent:2',
    ]);
    expect(readFileSync(target, 'utf8')).toBe('after-public-child');
    expect(calls).toHaveLength(6);
    expect(countedBodies).toHaveLength(6);
    expect(countedBodies).toEqual(expect.arrayContaining(calls.map((call) => call.body)));
    expect(new Set(calls.map((call) => call.key)).size).toBe(6);
    for (const call of calls) {
      expect(call.key).toMatch(/^[a-f0-9]{64}$/u);
      expect(call.authorization).toBe('Bearer private-upstream-canary');
      expect(call.body.stream).toBe(false);
    }
    expect(owner.ledger.grantOperationCount(owner.grant.id)).toBe(6);
    const budgets = [
      owner.ledger.budgetState('grant', owner.grant.id),
      owner.ledger.budgetState('task', owner.grant.tenant, owner.grant.task),
      owner.ledger.budgetState('tenant', owner.grant.tenant),
      owner.ledger.budgetState('global'),
    ];
    for (const budget of budgets) {
      expect(budget.spent).toEqual({
        tokens: 12,
        costMicros: 12,
        timeMs: budgets[0]?.spent.timeMs,
      });
      expect(budget.spent.timeMs).toBeGreaterThan(0);
      expect(budget.spent.timeMs).toBeLessThan(150_000);
      expect(budget.held).toEqual({ tokens: 0, timeMs: 0, costMicros: 0 });
      expect(budget.active).toBe(0);
    }
    const dispatches = a.entries.filter((entry) => entry.event.phase === 'dispatch');
    expect(dispatches).toHaveLength(6);
    expect(a.entries).toHaveLength(12);
    expect(incidents).toEqual([]);
    for (const dispatch of dispatches) {
      expect(
        a.entries
          .filter((entry) => entry.event.operationDigest === dispatch.event.operationDigest)
          .map((entry) => entry.event.phase),
      ).toEqual(['dispatch', 'complete']);
      const operation = await payloads.operation(owner.grant.id, dispatch.event.operationDigest);
      expect(operation).toMatchObject({
        grantId: owner.grant.id,
        actor: config.identity.actor,
        tenant: config.identity.tenant,
        task: config.identity.task,
      });
    }
    expect(new Set(dispatches.map((entry) => entry.event.operationDigest)).size).toBe(6);
    expect(JSON.parse(readFileSync(fixture.usageReceipt, 'utf8'))).toEqual({
      state: 'stopped',
      usage: { sessions: 1, modelCalls: 6, modelTokens: 12, costMicros: 12 },
    });
    const processText = readFileSync(fixture.processes, 'utf8');
    const processes = processText
      .trim()
      .split('\n')
      .map((line) => processRecord.parse(JSON.parse(line)));
    const children = processes.filter((record) => record.ipc);
    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child).toBeDefined();
    expect(processes.some((record) => record.pid === child?.ppid && !record.ipc)).toBe(true);
    for (const record of processes) {
      expect(record.cwd).toBe(fixture.worker);
      if (record.environment.PRODUCT_CONFIG_FILE !== undefined)
        expect(
          record.environment.PRODUCT_CONFIG_FILE.startsWith(`${fixture.f.directory}${sep}`),
        ).toBe(true);
      // The process probe runs before the main worker loads its explicit product config file.
      const runtime = resolveCliRuntimeContext({ environment: record.environment });
      for (const key of [
        'HOME',
        'PRODUCT_USER_STATE_DIR',
        'PRODUCT_CACHE_DIR',
        'PRODUCT_LOG_DIR',
      ]) {
        const value = runtime.environment[key];
        expect(typeof value, `${record.ipc ? 'child' : 'worker'} ${key}`).toBe('string');
        expect(value?.startsWith(`${fixture.f.directory}${sep}`)).toBe(true);
      }
      expect(record.environment.OPENAI_API_KEY).toBe(token);
      expect(record.environment.OPENAI_BASE_URL).toBe(new URL('/v1', config.broker.endpoint).href);
      expect(record.environment).not.toHaveProperty('ROBOTA_USER_STATE_DIR');
    }
    expect(
      `${processText}${JSON.stringify(a.entries)}${result.stdout}${result.stderr}`,
    ).not.toContain('private-upstream-canary');
    expect(`${processText}${result.stdout}${result.stderr}`).not.toContain(
      'runtime-upstream-canary',
    );
    expect(processText).not.toContain(upstreamEndpoint);
  } finally {
    await control.close();
    owner.cleanup();
    await fixture.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(custody, { recursive: true, force: true });
    rmSync(content, { recursive: true, force: true });
  }
}, 60_000);
