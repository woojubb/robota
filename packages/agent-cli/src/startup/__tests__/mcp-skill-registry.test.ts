import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import {
  admitHttpEndpoint,
  constructStreamableHttpTransport,
  openMcpSession,
  InMemoryMCPActivationApprovalStore,
  MCPDefinitionRegistry,
} from '@robota-sdk/agent-mcp';
import { createMemoryMcpSkillApprovalStore, McpSkillRegistry } from '../mcp-skill-registry.js';
import { createMcpClientComposition } from '../mcp-client-composition.js';
import { executeMCPActivationCommand } from '@robota-sdk/agent-command';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileMcpSkillApprovalStore } from '../mcp-skill-approval-file-store.js';
import { buildCommandSetup } from '../command-setup.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { parseCliArgs } from '../../utils/cli-args.js';

const uri = 'skill://same/demo/SKILL.md';
const childUri = 'skill://same/demo/child/SKILL.md';
const frontmatter = {
  name: 'demo',
  description: 'Use a verified workflow',
  'allowed-tools': 'Read',
  future: { retained: [true, null, 3] },
};
const childFrontmatter = {
  name: 'child',
  description: 'Use a nested workflow',
  'allowed-tools': 'Write',
};
const cleanups: (() => Promise<void>)[] = [];

async function fixture(serverId = 'server-a', viaComposition = false) {
  let holdChild = false;
  let childRead = () => {};
  let rootRead = () => {};
  let releaseRoot = () => {};
  let rootWait: Promise<void> | undefined;
  function holdRootRead() {
    rootWait = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    return new Promise<void>((resolve) => {
      rootRead = resolve;
    });
  }
  const holdChildRead = () =>
    new Promise<void>((resolve) => {
      holdChild = true;
      childRead = resolve;
    });
  const state = {
    body: 'Instructions.',
    declared: frontmatter,
    current: true,
    currentCheck: undefined as undefined | (() => Promise<boolean>),
    securityIdentity: `host-${serverId}`,
  };
  const methods: string[] = [];
  const text = (file: string) =>
    `---\n${JSON.stringify(file === uri ? frontmatter : childFrontmatter)}\n---\n${file === uri ? state.body : 'Nested instructions.'}`;
  const resource = (file: string) => ({
    uri: file,
    size: Buffer.byteLength(text(file)),
    digest: `sha256:${createHash('sha256').update(text(file)).digest('hex')}`,
  });
  const entry = (file: string) => ({
    uri: file,
    frontmatter: file === uri ? state.declared : childFrontmatter,
    resources: file === uri ? [resource(uri), resource(childUri)] : [resource(childUri)],
  });
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    methods.push(message.method);
    if (rootWait && message.method === 'resources/read' && message.params.uri === uri) {
      const waiting = rootWait;
      rootWait = undefined;
      rootRead();
      await waiting;
    }
    if (holdChild && message.method === 'resources/read' && message.params.uri === childUri) {
      childRead();
      return;
    }
    const base = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
    const result =
      message.method === 'server/discover'
        ? {
            ...base,
            supportedVersions: ['2026-07-28'],
            capabilities: { resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
          }
        : message.method === 'resources/list'
          ? { ...base, resources: [] }
          : message.method === 'skills/list'
            ? { ...base, skills: [entry(uri)] }
            : message.method === 'skills/get'
              ? { ...base, skill: entry(message.params.uri) }
              : {
                  ...base,
                  contents: [{ uri: message.params.uri, text: text(message.params.uri) }],
                };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  if (viaComposition) {
    const definition = {
      name: serverId,
      source: 'user' as const,
      origin: 'fixture',
      transport: 'http' as const,
      url: `http://127.0.0.1:${address.port}`,
      protocolVersion: '2026-07-28' as const,
      skills: true,
      unsetVariables: [],
    };
    const entries = [
      {
        name: serverId,
        source: definition.source,
        origin: definition.origin,
        status: 'resolved' as const,
        definition,
        shadowed: [],
      },
    ];
    const serverApprovals = new InMemoryMCPActivationApprovalStore();
    for (const request of new MCPDefinitionRegistry(entries).list())
      serverApprovals.put({
        ...request,
        approvalAuthority: 'user',
        decision: 'approved',
        decidedAt: new Date(0).toISOString(),
      });
    const approvals = createMemoryMcpSkillApprovalStore();
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: serverApprovals,
      skillApprovalStore: approvals,
      isDefinitionCurrent: () => state.current,
      transport: { policy: { allowedHosts: ['127.0.0.1'] } },
      reportDiagnostic: () => undefined,
    });
    cleanups.push(async () => {
      await composition.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await composition.connect();
    return {
      state,
      methods,
      approvals,
      registry: composition.skillRegistry,
      activationAdapter: composition.activationAdapter,
      holdChildRead,
      holdRootRead,
      releaseRoot: () => releaseRoot(),
      source: () => {
        throw new Error('No raw source for the composition fixture');
      },
    };
  }
  const admitted = await admitHttpEndpoint(
    { url: `http://127.0.0.1:${address.port}` },
    { policy: { allowedHosts: ['127.0.0.1'] } },
  );
  if (!admitted.ok) throw new Error(admitted.reason);
  const session = await openMcpSession({
    serverId,
    protocolVersion: '2026-07-28',
    skills: true,
    transport: constructStreamableHttpTransport(admitted.admitted),
    timeouts: { startupMs: 3000, perCallMs: 3000 },
  });
  cleanups.push(async () => {
    await session.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const source = () => ({
    serverId,
    securityIdentity: state.securityIdentity,
    skills: session.skills!,
    isCurrent: () => state.currentCheck?.() ?? state.current,
  });
  const approvals = createMemoryMcpSkillApprovalStore();
  const registry = new McpSkillRegistry(
    async (name) => (name === serverId ? source() : undefined),
    approvals,
  );
  return {
    state,
    methods,
    approvals,
    registry,
    source,
    holdChildRead,
    holdRootRead,
    releaseRoot: () => releaseRoot(),
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('routes discovered approved MCP instructions into actual user and model turns without eager reads', async () => {
  const f = await fixture('server-a', true);
  const skills = f.activationAdapter?.skills;
  const listed = await skills!.list('server-a');
  const source = skills?.commandSource;
  expect(source).toBeDefined();
  expect(f.methods.filter((method) => method === 'resources/read')).toHaveLength(0);
  const command = source!.getCommands()[0]!;
  expect(listed[0]).toMatchObject({ invocationName: command.name });
  await expect(command.skillContentLoader!.acquire()).rejects.toThrow(/skill-inspect/);
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  const run = vi.fn(async () => 'done');
  const directory = mkdtempSync(join(tmpdir(), 'mcp-skill-product-turn-'));
  cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
  const setup = buildCommandSetup(
    directory,
    parseCliArgs([]),
    {
      productRuntime: createTestProductRuntime('skill-fixture', { HOME: directory }),
      mcpActivationAdapter: f.activationAdapter,
    },
    '0.0.0-test',
  );
  const session = new InteractiveSession({
    cwd: directory,
    commandHostAdapters: setup.commandHostAdapters,
    commandModules: setup.baseCommandModules,
    session: {
      run,
      getSessionId: () => 'skill-turn',
      getHistory: () => [],
      getSystemMessage: () => 'system',
      getToolSchemas: () => [],
      getModelId: () => 'fixture',
      getProviderId: () => 'fixture',
      getPermissionMode: () => 'default',
      getContextState: () => ({
        usedTokens: 0,
        maxTokens: 1000,
        usedPercentage: 0,
        remainingPercentage: 100,
      }),
      getEventService: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    } as never,
  });
  await session.executeSkillCommandByName(command.name, 'task', {
    invocationSource: 'user',
    displayInput: '/remote task',
    rawInput: '/remote task',
  });
  expect(run).toHaveBeenCalledWith(expect.stringContaining('Instructions.'), '/remote task');
  run.mockImplementationOnce(async () => {
    const result = await session.executeSkillCommandByName(command.name, 'task', {
      invocationSource: 'model',
    });
    expect(result).toMatchObject({
      success: true,
      data: { mode: 'inject', prompt: expect.stringContaining('Instructions.') },
    });
    const resource = await session.executeModelCommand(
      'skill-read',
      JSON.stringify([command.name, childUri]),
    );
    expect(resource).toMatchObject({
      success: true,
      data: { uri: childUri, text: expect.stringContaining('Nested instructions.') },
    });
    expect(f.approvals.list()).toHaveLength(1);
    f.registry.withdraw('server-a', uri, 'user');
    const withdrawn = await session.executeModelCommand(
      'skill-read',
      JSON.stringify([command.name, childUri]),
    );
    expect(withdrawn?.success).toBe(false);
    return 'model used the skill';
  });
  await session.submit('use the discovered skill');
  const expired = await session.executeModelCommand(
    'skill-read',
    JSON.stringify([command.name, childUri]),
  );
  expect(expired).toMatchObject({ success: false, message: expect.stringContaining('active') });
  f.state.current = false;
  await expect(command.skillContentLoader!.acquire()).rejects.toBeDefined();
});

it('keeps identical advertised names from different origins separate and stable across metadata refresh', async () => {
  const a = await fixture('server-a', true);
  const b = await fixture('server-b', true);
  const first = await a.activationAdapter!.skills!.list('server-a');
  const other = await b.activationAdapter!.skills!.list('server-b');
  expect(first[0]!.name).toBe(other[0]!.name);
  expect(first[0]!.invocationName).not.toBe(other[0]!.invocationName);
  const refreshed = await a.activationAdapter!.skills!.list('server-a');
  expect(refreshed[0]!.invocationName).toBe(first[0]!.invocationName);
  expect([...a.methods, ...b.methods].filter((method) => method === 'resources/read')).toHaveLength(
    0,
  );
});

it('projects invocation restrictions and reports unsupported skill profiles without loading bytes', async () => {
  const f = await fixture('server-a', true);
  f.state.declared = {
    ...frontmatter,
    'disable-model-invocation': true,
    'user-invocable': false,
  } as typeof frontmatter;
  const skills = f.activationAdapter!.skills!;
  await skills.list('server-a');
  expect(skills.commandSource!.getCommands()[0]).toMatchObject({
    disableModelInvocation: true,
    userInvocable: false,
  });
  f.state.declared = { ...frontmatter, model: 'fixture-model' } as typeof frontmatter;
  const listed = await skills.list('server-a');
  expect(listed[0]).toMatchObject({ unavailableReason: expect.stringContaining('model') });
  expect(skills.commandSource!.getCommands()).toHaveLength(0);
  expect(f.methods.filter((method) => method === 'resources/read')).toHaveLength(0);
});

it('connects selected Skills through the actual product composition and retains both server and content consent', async () => {
  const f = await fixture('server-a', true);
  if (!f.activationAdapter) throw new Error('Expected product command adapter');
  const host = createTestCommandHost({
    overrides: {
      getCommandHostAdapters: () => ({ mcpActivation: f.activationAdapter }),
      getCommandInvocationSource: () => 'remote',
      getCommandSurfaceLocality: () => 'local',
      getCommandSurfaceLocalityEvidence: () => 'local',
    },
  });
  expect(f.methods).toEqual(['server/discover', 'resources/list']);
  const listed = await executeMCPActivationCommand(host, 'skill-list server-a');
  expect(listed.success).toBe(true);
  expect(listed.message).toContain('Use a verified workflow');
  const preview = await executeMCPActivationCommand(host, `skill-inspect server-a ${uri}`);
  expect(preview.success).toBe(true);
  await expect(f.registry.activate('server-a', uri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
  const approved = await executeMCPActivationCommand(
    host,
    `skill-approve server-a ${uri} ${preview.data?.['fingerprint']}`,
  );
  expect(approved.success).toBe(true);
  const active = await f.registry.activate('server-a', uri);
  expect(active.body).toBe('Instructions.');
  expect((await active.read(childUri)).text).toContain('Nested instructions.');
  active.close();
  const withdrawn = await executeMCPActivationCommand(host, `skill-withdraw server-a ${uri}`);
  expect(withdrawn.success).toBe(true);
  expect(f.approvals.list()).toEqual([]);
});

it('lists metadata without reading or activating files, and requires separate user consent', async () => {
  const f = await fixture();
  expect(await f.registry.list('server-a', 2)).toHaveLength(1);
  expect(f.methods).toEqual(['server/discover', 'skills/list']);
  await expect(f.registry.activate('server-a', uri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
  expect(f.approvals.list()).toEqual([]);
});

it('requires a known user and the exact inspected content hash before consent', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  const before = f.methods.length;
  for (const actor of ['model', 'remote', undefined] as const)
    await expect(
      f.registry.approve('server-a', uri, preview.fingerprint, actor),
    ).rejects.toMatchObject({ reason: 'user-only' });
  expect(f.methods).toHaveLength(before);
  f.state.body = 'Changed before approval';
  await expect(
    f.registry.approve('server-a', uri, preview.fingerprint, 'user'),
  ).rejects.toMatchObject({ reason: 'content-changed' });
  expect(f.approvals.list()).toEqual([]);
});

it('refuses verbatim YAML/manifest mismatch and reports no peer content in the error', async () => {
  const f = await fixture();
  f.state.declared = { ...frontmatter, description: 'credential-canary' };
  const error = await f.registry.inspect('server-a', uri).catch((error) => error);
  expect(error.reason).toBe('frontmatter-mismatch');
  expect(error.message).not.toContain('credential-canary');
});

it('reads nested SKILL.md as supporting bytes and requires its own fresh approval for activation', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  const active = await f.registry.activate('server-a', uri);
  expect((await active.read(childUri)).text).toContain('Nested instructions.');
  expect(f.approvals.list()).toHaveLength(1);
  await expect(f.registry.activate('server-a', childUri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
  active.close();
  await expect(active.read(childUri)).rejects.toMatchObject({ reason: 'activation-ended' });
});

it('revokes changed manifests and does not resurrect consent when content reverts', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  const active = await f.registry.activate('server-a', uri);
  f.state.body = 'Changed after activation';
  await expect(active.read(childUri)).rejects.toMatchObject({ reason: 'content-changed' });
  expect(f.approvals.list()).toEqual([]);
  f.state.body = 'Instructions.';
  await expect(f.registry.activate('server-a', uri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
});

it('preserves both server and URI in consent and a reversible virtual namespace', async () => {
  const a = await fixture('server-a');
  const b = await fixture('server-b');
  const registry = new McpSkillRegistry(
    async (name) => (name === 'server-a' ? a.source() : b.source()),
    a.approvals,
  );
  const first = await registry.inspect('server-a', uri);
  const second = await registry.inspect('server-b', uri);
  expect(first.namespace).not.toBe(second.namespace);
  expect(
    JSON.parse(
      Buffer.from(first.namespace.slice('mcp-skill:'.length), 'base64url').toString('utf8'),
    ),
  ).toEqual(['server-a', 'host-server-a', uri, 'user']);
  await registry.approve('server-a', uri, first.fingerprint, 'user');
  await expect(registry.activate('server-b', uri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
});

it('refuses new file dispatch when the host disables or replaces the source', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  const active = await f.registry.activate('server-a', uri);
  const before = f.methods.length;
  f.state.current = false;
  await expect(active.read(childUri)).rejects.toMatchObject({ reason: 'source-changed' });
  expect(f.methods).toHaveLength(before);
  expect(f.approvals.list()).toEqual([]);
});

it('cancels an in-flight supporting read when its activation window closes without replaying it', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  const active = await f.registry.activate('server-a', uri);
  const reached = f.holdChildRead();
  const pending = active.read(childUri);
  await reached;
  active.close();
  await expect(pending).rejects.toBeDefined();
  expect(f.methods.filter((method) => method === 'resources/read')).toHaveLength(4);
  expect(f.approvals.list()).toHaveLength(1);
});

it('withdrawal wins over an approval still waiting for verified instructions', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  const reached = f.holdRootRead();
  const pending = f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  await reached;
  f.registry.withdraw('server-a', uri, 'user');
  f.releaseRoot();
  await expect(pending).rejects.toBeDefined();
  expect(f.approvals.list()).toEqual([]);
});

it('metadata refresh withdraws changed content consent even if the peer reverts before activation', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  f.state.body = 'Observed changed manifest';
  await f.registry.list('server-a', 2);
  f.state.body = 'Instructions.';
  await expect(f.registry.activate('server-a', uri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
});

it('does not reuse or erase another workspace content consent for the same server and URI', async () => {
  const f = await fixture();
  const a = new McpSkillRegistry(async () => f.source(), f.approvals, 'workspace-a');
  const b = new McpSkillRegistry(async () => f.source(), f.approvals, 'workspace-b');
  const preview = await a.inspect('server-a', uri);
  await a.approve('server-a', uri, preview.fingerprint, 'user');
  await expect(b.activate('server-a', uri)).rejects.toMatchObject({ reason: 'approval-required' });
  const active = await a.activate('server-a', uri);
  active.close();
  expect(f.approvals.list()).toHaveLength(1);
});

it('persists observed content revocation across a registry restart and reverted peer bytes', async () => {
  const f = await fixture();
  const root = mkdtempSync(join(tmpdir(), 'mcp-skill-restart-'));
  cleanups.push(async () => {
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(root, 'approvals.json');
  const first = new McpSkillRegistry(async () => f.source(), createFileMcpSkillApprovalStore(path));
  const preview = await first.inspect('server-a', uri);
  await first.approve('server-a', uri, preview.fingerprint, 'user');
  const second = new McpSkillRegistry(
    async () => f.source(),
    createFileMcpSkillApprovalStore(path),
  );
  const active = await second.activate('server-a', uri);
  active.close();
  f.state.body = 'Changed before restart';
  await second.list('server-a', 2);
  f.state.body = 'Instructions.';
  const third = new McpSkillRegistry(async () => f.source(), createFileMcpSkillApprovalStore(path));
  await expect(third.activate('server-a', uri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
});

it('does not resurrect consent after a malformed metadata refresh is repaired', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  f.state.declared = { ...frontmatter, name: 'invalid_name' };
  await expect(f.registry.list('server-a', 2)).rejects.toBeDefined();
  f.state.declared = frontmatter;
  await expect(f.registry.activate('server-a', uri)).rejects.toMatchObject({
    reason: 'approval-required',
  });
});

it.each(['withdraw', 'close'] as const)(
  'refuses verified bytes after %s during the final awaited authority check',
  async (action) => {
    const f = await fixture();
    const preview = await f.registry.inspect('server-a', uri);
    await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
    const active = await f.registry.activate('server-a', uri);
    let checked = () => {};
    const reached = new Promise<void>((resolve) => {
      checked = resolve;
    });
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checks = 0;
    f.state.currentCheck = async () => {
      if (++checks === 2) {
        checked();
        await waiting;
      }
      return true;
    };
    const pending = active.read(childUri);
    await reached;
    if (action === 'withdraw') f.registry.withdraw('server-a', uri, 'user');
    else active.close();
    release();
    await expect(pending).rejects.toBeDefined();
    expect(f.methods.filter((method) => method === 'resources/read')).toHaveLength(4);
  },
);

it('revalidates an active instruction window using fresh metadata without eager file reads', async () => {
  const f = await fixture();
  const preview = await f.registry.inspect('server-a', uri);
  await f.registry.approve('server-a', uri, preview.fingerprint, 'user');
  const active = await f.registry.activate('server-a', uri);
  await active.validate();
  expect(f.methods.filter((method) => method === 'resources/read')).toHaveLength(3);
  f.state.body = 'Changed instructions';
  await expect(active.validate()).rejects.toMatchObject({ reason: 'content-changed' });
  expect(f.approvals.list()).toEqual([]);
});
