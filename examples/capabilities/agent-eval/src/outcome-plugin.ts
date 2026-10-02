import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  registerToolPermissionProfile,
  type IChatOptions,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';
import {
  createAgentRuntime,
  createHostBundlePluginLoader,
  createSessionRunFn,
  runEval,
} from '@robota-sdk/agent-framework';
import {
  buildCatalog,
  createDiscoveredTool,
  createStdioAdapter,
  MCPActivationAdmissionService,
  MCPDefinitionRegistry,
  openMcpSession,
  type IMCPSession,
} from '@robota-sdk/agent-mcp';
import { ReplayProvider } from '@robota-sdk/agent-provider-replay';

import { summarizeTrials, type IOutcomeTrial } from './outcome-report.js';
import { assertStaleState, type IStateObservation } from './outcome-state.js';

class ObservedReplayProvider extends ReplayProvider {
  readonly requests: TUniversalMessage[][] = [];
  override chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
    this.requests.push([...messages]);
    return super.chat(messages, options);
  }
}

const root = mkdtempSync(join(tmpdir(), 'external-state-outcome-'));
const oldHome = process.env.HOME;
const oldState = process.env.PRODUCT_USER_STATE_DIR;
let connection: IMCPSession | undefined;
try {
  const home = join(root, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  process.env.PRODUCT_USER_STATE_DIR = join(root, 'product-state');
  const pluginsDir = join(root, 'plugins');
  const pluginRoot = join(pluginsDir, 'cache', 'fixture', 'state-fixture', '1.0.0');
  const fixture = fileURLToPath(new URL('../fixtures/state-plugin', import.meta.url));
  cpSync(fixture, pluginRoot, { recursive: true });
  const statePath = join(root, 'setting.json');
  writeFileSync(
    statePath,
    JSON.stringify({ value: 'off', revision: 'revision-0', effects: 0, calls: [] }),
  );
  const loaded = createHostBundlePluginLoader({
    pluginsDir,
    enabledPlugins: { 'state-fixture@fixture': true },
  }).loadPluginsSync();
  const plugin = loaded[0];
  if (loaded.length !== 1 || !plugin?.mcpConfig)
    throw new Error('Packaged MCP contribution was not loaded');
  const sourceRevision = createHash('sha256');
  for (const path of ['.claude-plugin/plugin.json', '.mcp.json', 'server.mjs']) {
    sourceRevision.update(path).update(readFileSync(join(pluginRoot, path)));
  }
  const revision = sourceRevision.digest('hex');
  // The consumer resolves this fixture's two declared placeholders and explicitly approves exact argv.
  const config = JSON.parse(JSON.stringify(plugin.mcpConfig)) as {
    mcpServers: { state: { command: string; args: string[] } };
  };
  const args = config.mcpServers.state.args.map((arg) =>
    arg.replace('${CLAUDE_PLUGIN_ROOT}', pluginRoot).replace('${FIXTURE_STATE_PATH}', statePath),
  );
  const definition = {
    name: 'state',
    source: 'plugin' as const,
    origin: `state-fixture@${revision}`,
    transport: 'stdio' as const,
    command: process.execPath,
    args,
    unsetVariables: [],
  };
  const activation = new MCPDefinitionRegistry(
    [
      {
        name: definition.name,
        source: definition.source,
        origin: definition.origin,
        status: 'resolved',
        definition,
        shadowed: [],
      },
    ],
    { workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 } },
  ).list()[0];
  if (!activation) throw new Error('Missing activation');
  const admission = new MCPActivationAdmissionService();
  admission.approve(activation);
  const adapter = createStdioAdapter({
    admission,
    authority: {
      allowedRoot: root,
      generation: '1',
      executables: [{ command: process.execPath, args: [args] }],
      environment: { HOME: home },
    },
  });
  const admitted = await adapter.admit({ definition, activation });
  if (!admitted.ok) throw new Error(admitted.reason);
  connection = await openMcpSession({
    serverId: 'state',
    transport: adapter.construct(admitted.admitted),
    timeouts: { startupMs: 5000, perCallMs: 5000 },
  });
  const catalog = buildCatalog([
    {
      serverId: 'state',
      origin: definition.origin,
      transport: 'stdio',
      discovery: await connection.discover({ maxPages: 2, perRequestTimeoutMs: 5000 }),
    },
  ]);
  const entries = [...catalog.adopted, ...catalog.adapted].filter((entry) => entry.kind === 'tool');
  const observe = entries.find((entry) => entry.sourceName === 'observe');
  const change = entries.find((entry) => entry.sourceName === 'change');
  if (!observe || !change || entries.length !== 2) throw new Error('Incomplete tool catalog');
  registerToolPermissionProfile(observe.canonicalName, { riskClass: 'inspect' });
  registerToolPermissionProfile(change.canonicalName, { riskClass: 'modify' });
  const invoker = connection;
  const tools = entries.map((entry) => createDiscoveredTool(entry, invoker));
  for (const stale of [false, true]) {
    const trials: IOutcomeTrial[] = [];
    for (let trial = 1; trial <= 3; trial++) {
      writeFileSync(
        statePath,
        JSON.stringify({ value: 'off', revision: 'revision-0', effects: 0, calls: [] }),
      );
      const rounds = [
        { name: observe.canonicalName, args: {} },
        {
          name: change.canonicalName,
          args: { revision: stale ? 'stale' : 'revision-0', value: 'on' },
        },
        { name: observe.canonicalName, args: {} },
      ];
      const entries = rounds.map((call, round) => ({
        schemaVersion: 1,
        timestamp: '2026-10-01T00:00:00.000Z',
        sessionId: 'fixture',
        event: 'provider_response_normalized',
        executionId: 'trial',
        conversationId: 'fixture',
        round,
        toolCallsCount: 1,
        response: {
          role: 'assistant',
          content: '',
          id: `a${round}`,
          timestamp: '2026-10-01T00:00:00.000Z',
          state: 'complete',
          toolCalls: [
            {
              id: `call-${round}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            },
          ],
        },
      }));
      const provider = new ObservedReplayProvider({
        entries: [
          ...entries,
          {
            schemaVersion: 1,
            timestamp: '2026-10-01T00:00:00.000Z',
            sessionId: 'fixture',
            event: 'provider_response_normalized',
            executionId: 'trial',
            conversationId: 'fixture',
            round: 3,
            toolCallsCount: 0,
            response: {
              role: 'assistant',
              content: 'Done',
              id: 'a3',
              timestamp: '2026-10-01T00:00:00.000Z',
              state: 'complete',
            },
          },
        ],
      });
      const start = performance.now();
      const result = await createSessionRunFn(createAgentRuntime({ cwd: root, provider }), {
        bare: true,
        permissionMode: 'acceptEdits',
        additionalTools: tools,
        allowedTools: [observe.canonicalName, change.canonicalName],
        deniedTools: [
          'Bash',
          'Shell',
          'Write',
          'Edit',
          'WebFetch',
          'WebSearch',
          'BackgroundProcess',
        ],
      })('Observe the setting, turn it on, and verify the new state.');
      const pairedIds = (provider.requests.at(-1) ?? [])
        .filter((message) => message.role === 'tool')
        .map((message) => message.toolCallId);
      if (pairedIds.join(',') !== 'call-0,call-1,call-2')
        throw new Error('Model did not receive exactly one result for every call ID');
      const observed = Object.freeze(
        JSON.parse(readFileSync(statePath, 'utf8')) as IStateObservation,
      );
      if (stale) assertStaleState(observed);
      const report = await runEval(
        {
          cases: [{ input: 'setting' }],
          threshold: 0.5,
          metrics: [
            {
              name: 'stored-outcome',
              required: true,
              score: () =>
                observed.value === 'on' &&
                observed.effects === 1 &&
                observed.calls.join(',') === 'observe,change,observe',
            },
            { name: 'claims-done', score: (run) => run.response === 'Done' },
          ],
        },
        async () => result,
      );
      if (report.passed === stale)
        throw new Error('Plugin outcome gate returned the wrong verdict');
      trials.push({
        success: report.passed,
        costUsd: result.usage?.costStatus !== 'unknown' ? (result.usage?.costUsd ?? null) : null,
      });
      console.log(
        JSON.stringify({
          fixture: 'external-non-GUI',
          sourceRevision: revision,
          trial,
          sampleSizePerVariant: 3,
          stochasticComparison: false,
          provider: 'replay',
          model: 'offline-recorded',
          permissionMode: 'acceptEdits',
          replay: true,
          pairedIds,
          elapsedMs: performance.now() - start,
          costUsd: result.usage?.costStatus !== 'unknown' ? (result.usage?.costUsd ?? null) : null,
          stale,
          passed: report.passed,
          effects: observed.effects,
          calls: observed.calls,
          toolSteps: result.toolSummaries.length,
          isolation: 'temporary-state and admitted exact process; no OS sandbox',
        }),
      );
    }
    console.log(
      JSON.stringify({ fixture: 'external-non-GUI-summary', stale, ...summarizeTrials(trials) }),
    );
  }
} finally {
  try {
    await connection?.close();
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldState === undefined) delete process.env.PRODUCT_USER_STATE_DIR;
    else process.env.PRODUCT_USER_STATE_DIR = oldState;
    rmSync(root, { recursive: true, force: true });
  }
}
