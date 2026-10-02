import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AbstractAIProvider,
  registerToolPermissionProfile,
  type IChatOptions,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import {
  createAgentRuntime,
  createHostBundlePluginLoader,
  createSessionRunFn,
  createNodeHostSessionStore,
  type InteractiveSession,
} from '@robota-sdk/agent-framework';
import {
  buildCatalog,
  createDiscoveredTool,
  createStdioAdapter,
  MCPActivationAdmissionService,
  MCPDefinitionRegistry,
  openMcpSession,
  type IMCPSession,
  type IMCPCatalogToolEntry,
} from '@robota-sdk/agent-mcp';

import { startBrowserDemo } from './outcome-browser-demo.js';
import { assertBrowserReconciled } from './outcome-browser-reconciliation.js';

const [packageArgument, browserArgument, countArgument = '20', variant = 'success'] =
  process.argv.slice(2);
const callLimit = Number(countArgument);
if (
  process.platform !== 'linux' ||
  !packageArgument ||
  !browserArgument ||
  ![1, 20, 100].includes(callLimit) ||
  !['success', 'stale-target', 'false-done', 'cancel-after-save'].includes(variant) ||
  (variant !== 'success' && callLimit === 1)
) {
  throw new Error(
    'Usage: baseline:browser <installed @playwright/mcp directory> <Chromium executable> <1|20|100> [success|stale-target|false-done|cancel-after-save]; Linux only',
  );
}
const packageRoot = realpathSync(packageArgument);
const browser = realpathSync(browserArgument);
const packageBytes = readFileSync(join(packageRoot, 'package.json'));
const installedPackage = JSON.parse(packageBytes.toString()) as { name?: string; version?: string };
if (installedPackage.name !== '@playwright/mcp' || installedPackage.version !== '0.0.83')
  throw new Error('This fixture requires exactly @playwright/mcp@0.0.83');
const cli = join(packageRoot, 'cli.js');
const packageDigest = createHash('sha256')
  .update(packageBytes)
  .update(readFileSync(cli))
  .digest('hex');

/** A deterministic observation-driven provider, with no paid/network model calls. */
class BrowserFixtureProvider extends AbstractAIProvider {
  readonly name = 'browser-fixture-script';
  readonly version = '1.0.0';
  readonly receipts = new Map<string, TUniversalMessage>();
  readonly calls: { id: string; name: string }[] = [];
  private stage = 0;
  private cycle = 0;
  private readonly cycles =
    callLimit === 1
      ? 0
      : (() => {
          const maximum = Math.floor((callLimit - 2 - (variant === 'stale-target' ? 2 : 0)) / 3);
          return maximum % 2 === 1 ? maximum : maximum - 1;
        })();
  private staleInjected = false;
  private failedCallId: string | undefined;
  private snapshot = '';
  private theme = 'light';

  constructor(
    private readonly names: Map<string, string>,
    private readonly url: string,
  ) {
    super();
  }
  override supportsTools() {
    return true;
  }
  override async chat(
    messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    for (const message of messages) {
      if (message.role === 'tool') this.receipts.set(message.toolCallId, message);
    }
    const last = messages.filter((message) => message.role === 'tool').at(-1);
    const content = last?.content ?? '';
    if (
      this.failedCallId &&
      !this.receipts.get(this.failedCallId)?.content?.match(/error|not found|does not exist/i)
    )
      throw new Error('The deliberately stale target did not fail');
    if (this.failedCallId) this.failedCallId = undefined;
    const reference = (label: string) => {
      const match = new RegExp(`${label}[^\\n]*\\[ref=([^\\]]+)\\]`).exec(this.snapshot);
      if (!match?.[1]) throw new Error(`Missing live snapshot reference for ${label}`);
      return match[1];
    };
    let name: string;
    let args: Record<string, unknown>;
    if (this.calls.length === callLimit || (variant === 'false-done' && this.calls.length === 1)) {
      return {
        role: 'assistant',
        content: 'Done',
        id: 'final',
        timestamp: new Date(),
        state: 'complete',
      };
    }
    if (this.calls.length === 0) {
      name = 'browser_navigate';
      args = { url: this.url };
    } else if (this.cycle < this.cycles) {
      if (this.stage === 0) {
        name = 'browser_snapshot';
        args = {};
        this.stage = 1;
      } else if (this.stage === 1) {
        this.snapshot = content;
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        name = 'browser_fill_form';
        args = {
          fields: [
            {
              name: 'Theme',
              type: 'textbox',
              target: reference('textbox "Theme"'),
              value: this.theme,
            },
          ],
        };
        this.stage = 2;
      } else if (variant === 'stale-target' && !this.staleInjected) {
        name = 'browser_click';
        args = { element: 'Save', target: 'deliberately-stale-target' };
        this.staleInjected = true;
        this.stage = 3;
        this.failedCallId = `browser-call-${this.calls.length + 1}`;
      } else if (this.stage === 3) {
        // Re-observe after a failed action before choosing a fresh target; never replay its mutation.
        name = 'browser_snapshot';
        args = {};
        this.stage = 4;
      } else {
        if (this.stage === 4) this.snapshot = content;
        name = 'browser_click';
        args = { element: 'Save', target: reference('button "Save"') };
        this.stage = 0;
        this.cycle++;
      }
    } else if (this.calls.length === callLimit - 1 && callLimit > 1) {
      name = 'browser_take_screenshot';
      args = { scale: 'css' };
    } else {
      name = 'browser_snapshot';
      args = {};
    }
    const canonicalName = this.names.get(name);
    if (!canonicalName) throw new Error(`Missing tool ${name}`);
    const id = `browser-call-${this.calls.length + 1}`;
    this.calls.push({ id, name: canonicalName });
    return {
      role: 'assistant',
      content: '',
      id: `assistant-${id}`,
      timestamp: new Date(),
      state: 'complete',
      toolCalls: [
        {
          id,
          type: 'function',
          function: { name: canonicalName, arguments: JSON.stringify(args) },
        },
      ],
    };
  }
  expectedState() {
    return { theme: callLimit === 1 ? 'light' : 'dark', writes: this.cycles };
  }
}

const root = mkdtempSync(join(tmpdir(), 'browser-outcome-'));
const oldHome = process.env.HOME;
const oldState = process.env.PRODUCT_USER_STATE_DIR;
let connection: IMCPSession | undefined;
let interruptedOwner: InteractiveSession | undefined;
let restoredOwner: InteractiveSession | undefined;
let report: Record<string, unknown> | undefined;
let demo: Awaited<ReturnType<typeof startBrowserDemo>> | undefined;
try {
  const home = join(root, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  process.env.PRODUCT_USER_STATE_DIR = join(root, 'product-state');
  demo = await startBrowserDemo(root);
  const pluginsDir = join(root, 'plugins');
  const pluginRoot = join(pluginsDir, 'cache', 'pilot', 'browser-pilot', '0.0.83');
  mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
  const args = [
    cli,
    '--headless',
    '--isolated',
    '--executable-path',
    browser,
    '--allowed-origins',
    demo.url,
    '--block-service-workers',
    '--output-dir',
    join(root, 'artifacts'),
    '--viewport-size',
    '640x480',
    '--timeout-action',
    '5000',
    '--timeout-navigation',
    '10000',
  ];
  writeFileSync(
    join(pluginRoot, '.claude-plugin/plugin.json'),
    JSON.stringify({
      name: 'browser-pilot',
      mcpServers: { browser: { command: process.execPath, args } },
    }),
  );
  const plugin = createHostBundlePluginLoader({
    pluginsDir,
    enabledPlugins: { 'browser-pilot@pilot': true },
  }).loadPluginsSync()[0];
  const config = plugin?.mcpConfig as
    { mcpServers?: { browser?: { command?: string; args?: string[] } } } | undefined;
  const declared = config?.mcpServers?.browser;
  if (
    !declared ||
    declared.command !== process.execPath ||
    JSON.stringify(declared.args) !== JSON.stringify(args)
  )
    throw new Error('Installed bundle declaration did not resolve');
  const definition = {
    name: 'browser',
    source: 'plugin' as const,
    origin: `browser-pilot@0.0.83:${packageDigest}`,
    transport: 'stdio' as const,
    command: process.execPath,
    args,
    cwd: pluginRoot,
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
  if (!activation) throw new Error('Missing pinned activation');
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
    serverId: 'browser',
    transport: adapter.construct(admitted.admitted),
    timeouts: { startupMs: 15000, perCallMs: 15000 },
  });
  const catalog = buildCatalog([
    {
      serverId: 'browser',
      origin: definition.origin,
      transport: 'stdio',
      discovery: await connection.discover({ maxPages: 2, perRequestTimeoutMs: 15000 }),
    },
  ]);
  const needed = [
    'browser_navigate',
    'browser_snapshot',
    'browser_fill_form',
    'browser_click',
    'browser_take_screenshot',
  ];
  const entries = [...catalog.adopted, ...catalog.adapted].filter(
    (entry): entry is IMCPCatalogToolEntry =>
      entry.kind === 'tool' && needed.includes(entry.sourceName),
  );
  const names = new Map(entries.map((entry) => [entry.sourceName, entry.canonicalName]));
  const provider = new BrowserFixtureProvider(names, demo.url);
  const timings: { name: string; elapsedMs: number; success: boolean }[] = [];
  const rawImages: { bytes: number; sha256: string }[] = [];
  const invoker = connection;
  let cancelRequestedAt: number | undefined;
  let cancellationPropagated = false;
  let persistedBeforeAbort: { theme: string; writes: number } | undefined;
  const measuredInvoker = {
    callTool: async (...parameters: Parameters<IMCPSession['callTool']>) => {
      const started = performance.now();
      const result = await invoker.callTool(...parameters);
      timings.push({
        name: parameters[0],
        elapsedMs: performance.now() - started,
        success: !result.isError,
      });
      for (const content of result.content) {
        if (content.type === 'image') {
          if (typeof content.data !== 'string') throw new Error('MCP returned invalid image data');
          const bytes = Buffer.from(content.data, 'base64');
          rawImages.push({
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
        }
      }
      if (
        variant === 'cancel-after-save' &&
        parameters[0] === 'browser_click' &&
        cancelRequestedAt === undefined
      ) {
        // The fixture discards a real reply after independently observing the effect. This is a
        // lost-observation boundary, not a claim that cancellation terminated the browser action.
        const deadline = performance.now() + 5000;
        for (;;) {
          const observed = JSON.parse(readFileSync(demo!.statePath, 'utf8')) as {
            theme: string;
            writes: number;
          };
          if (observed.writes === 1) {
            persistedBeforeAbort = observed;
            break;
          }
          if (performance.now() >= deadline)
            throw new Error('Browser save did not persist before cancellation');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        cancelRequestedAt = performance.now();
        interruptedOwner!.abort();
        cancellationPropagated = parameters[2]?.signal?.aborted === true;
        throw new DOMException(
          'Fixture withheld the browser receipt after its effect',
          'AbortError',
        );
      }
      return result;
    },
  };
  const tools = entries.map((entry) => {
    registerToolPermissionProfile(entry.canonicalName, {
      riskClass:
        entry.sourceName === 'browser_click' || entry.sourceName === 'browser_fill_form'
          ? 'modify'
          : 'inspect',
    });
    return createDiscoveredTool(entry, measuredInvoker);
  });
  const started = performance.now();
  const options = {
    bare: true,
    maxTurns: callLimit + 2,
    permissionMode: 'acceptEdits' as const,
    additionalTools: tools,
    allowedTools: tools.map((tool) => tool.getName()),
    deniedTools: ['Bash', 'Shell', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'BackgroundProcess'],
  };
  let reconciliation: Record<string, unknown> | undefined;
  let result: Awaited<ReturnType<ReturnType<typeof createSessionRunFn>>>;
  if (variant === 'cancel-after-save') {
    const storeDirectory = join(root, 'sessions');
    const store = createNodeHostSessionStore(storeDirectory);
    interruptedOwner = createAgentRuntime({
      cwd: root,
      provider,
      sessionStore: store,
    }).createSession(options);
    const interrupted = await (
      await interruptedOwner.submit('Save dark once; reconcile if the observation is lost.')
    ).completed;
    const cancellationLatencyMs =
      cancelRequestedAt === undefined ? null : performance.now() - cancelRequestedAt;
    const sessionId = interruptedOwner.getSession().getSessionId();
    await interruptedOwner.shutdown();
    interruptedOwner = undefined;
    const loaded = store.load(sessionId);
    if (loaded.status !== 'valid')
      throw new Error(`Fixture persistence did not retain a valid session (${loaded.status})`);
    const continuation = createScriptedProvider([
      { toolCalls: [{ name: names.get('browser_snapshot')!, args: {} }] },
      { text: 'Reconciled the persisted preference without repeating Save.' },
    ]);
    const firstCallCount = timings.length;
    restoredOwner = createAgentRuntime({
      cwd: root,
      provider: { ...continuation.provider, name: provider.name },
      sessionStore: createNodeHostSessionStore(storeDirectory),
    }).createSession({ ...options, resumeSessionId: sessionId });
    result = await (
      await restoredOwner.submit('Observe current state before considering another mutation.')
    ).completed;
    for (const message of continuation.requests.at(-1) ?? []) {
      if (message.role === 'tool') provider.receipts.set(message.toolCallId, message);
    }
    const stateAfter = JSON.parse(readFileSync(demo.statePath, 'utf8')) as {
      theme: string;
      writes: number;
    };
    const cancelledCallId = provider.calls.at(-1)?.id;
    const restoredOutcome =
      continuation.requests[0]?.some(
        (message) =>
          message.role === 'tool' &&
          message.toolCallId === cancelledCallId &&
          message.metadata?.success === false,
      ) === true;
    const sameSessionId = restoredOwner.getSession().getSessionId() === sessionId;
    const resumedCalls = timings.slice(firstCallCount).map((call) => call.name);
    assertBrowserReconciled({
      interrupted: interrupted.interrupted === true,
      resumedInterrupted: result.interrupted === true,
      cancellationPropagated,
      restoredOutcome,
      sameSessionId,
      before: persistedBeforeAbort,
      after: stateAfter,
      resumedCalls,
    });
    reconciliation = {
      interrupted: true,
      resumed: true,
      restoredOutcome,
      sameSessionId,
      cancellationPropagated,
      before: persistedBeforeAbort,
      after: stateAfter,
      resumedCalls,
      cancellationLatencyMs,
      boundary:
        'actual browser save persisted; fixture discarded its reply; cooperative abort; same-session fresh observation',
    };
    await restoredOwner.shutdown();
    restoredOwner = undefined;
  } else {
    result = await createSessionRunFn(
      createAgentRuntime({ cwd: root, provider }),
      options,
    )('Observe the disposable app, change its theme, and verify the persisted result.');
  }
  const state = JSON.parse(readFileSync(demo.statePath, 'utf8')) as {
    theme: string;
    writes: number;
  };
  const expected =
    variant === 'cancel-after-save' ? { theme: 'dark', writes: 1 } : provider.expectedState();
  const paired =
    provider.calls.every((call) => provider.receipts.has(call.id)) &&
    provider.receipts.size ===
      (variant === 'cancel-after-save' ? provider.calls.length + 1 : callLimit);
  const images = [...provider.receipts.values()]
    .flatMap((message) => message.parts ?? [])
    .filter((part) => part.type === 'image_inline')
    .map((part) => ({
      bytes: Buffer.from(part.data, 'base64').length,
      sha256: createHash('sha256').update(Buffer.from(part.data, 'base64')).digest('hex'),
    }));
  const failures = timings.filter((call) => !call.success).length;
  const exactMedia = JSON.stringify(images) === JSON.stringify(rawImages);
  const success =
    variant === 'cancel-after-save'
      ? reconciliation !== undefined && paired
      : !result.interrupted &&
        state.theme === expected.theme &&
        state.writes === expected.writes &&
        paired &&
        timings.length === callLimit &&
        result.toolSummaries.length === callLimit &&
        (callLimit === 1 || images.length > 0) &&
        exactMedia &&
        failures === (variant === 'stale-target' ? 1 : 0);
  report = {
    fixture: 'Linux Playwright MCP',
    package: { name: installedPackage.name, version: installedPackage.version },
    packageEntryDigest: packageDigest,
    browser,
    callLimit,
    variant,
    reconciliation,
    success,
    state,
    expected,
    paired,
    pairedIds: [...provider.receipts.keys()],
    failures,
    images,
    exactMedia,
    elapsedMs: performance.now() - started,
    transportToolMs: timings.reduce((sum, call) => sum + call.elapsedMs, 0),
    calls: timings,
    timingBreakdown: { model: null, queue: null, permission: null, transport: null, tool: null },
    provider: provider.name,
    paidModelRequests: 0,
    costUsd: null,
    sampleSize: 1,
    stochasticComparison: false,
    route: 'installed bundle; admitted MCP; real framework headless session',
    isolation: 'temporary HOME/product state; isolated browser context; no OS sandbox',
  };
  if (!success) process.exitCode = 1;
} finally {
  await Promise.allSettled([interruptedOwner?.shutdown(), restoredOwner?.shutdown()]);
  try {
    await connection?.close();
  } finally {
    try {
      await demo?.close();
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldState === undefined) delete process.env.PRODUCT_USER_STATE_DIR;
      else process.env.PRODUCT_USER_STATE_DIR = oldState;
      rmSync(root, { recursive: true, force: true });
    }
  }
}

if (report)
  console.log(
    JSON.stringify({
      ...report,
      cleanup: {
        mcpCloseSettled: true,
        httpCloseSettled: true,
        temporaryStateRemoved: !existsSync(root),
        stateEnvironmentRestored:
          process.env.HOME === oldHome && process.env.PRODUCT_USER_STATE_DIR === oldState,
      },
    }),
  );
