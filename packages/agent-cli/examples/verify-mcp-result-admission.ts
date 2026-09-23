/** MCP-2525 public scenario: a real session submits only an admitted MCP result to its provider. */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IMCPCatalogToolEntry, IMCPDiscovery } from '@robota-sdk/agent-mcp';

const home = mkdtempSync(join(tmpdir(), 'verify-mcp-result-admission-'));
process.env['HOME'] = home;

const { createScriptedProvider } = await import('@robota-sdk/agent-core/testing');
const { InteractiveSession } = await import('@robota-sdk/agent-framework');
const { buildCatalog, createDiscoveredTool } = await import('@robota-sdk/agent-mcp');
const { createNodeToolResultSpillStore } = await import('@robota-sdk/agent-framework');

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resultTool(): IMCPCatalogToolEntry {
  const discovery: IMCPDiscovery = {
    identity: {
      serverId: 'scenario',
      serverName: 'controlled-server',
      serverVersion: '1',
      protocolVersion: '2025-06-18',
    },
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      items: [
        {
          name: 'answer',
          description: 'Return a controlled answer',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };
  const catalog = buildCatalog([
    { serverId: 'scenario', origin: 'scenario', transport: 'stdio', discovery },
  ]);
  const entry = catalog.adopted[0];
  requireCondition(entry?.kind === 'tool', 'catalog did not adopt the controlled tool');
  return entry;
}

async function run(mode: string): Promise<void> {
  requireCondition(mode === '--within-limit' || mode === '--overflow', 'unknown scenario mode');
  const overflow = mode === '--overflow';
  const secret = `private-payload=${'x'.repeat(350)}`;
  const raw = overflow ? secret : 'small admitted answer';
  const entry = resultTool();
  let spillStore: ReturnType<typeof createNodeToolResultSpillStore> | undefined;
  const tool = createDiscoveredTool(
    entry,
    { callTool: async () => ({ content: [{ type: 'text', text: raw }], isError: false }) },
    {
      admission: {
        warningChars: 100,
        hardChars: 200,
        repositoryMaxChars: 500,
        spillStore: {
          write: (content) => {
            spillStore ??= createNodeToolResultSpillStore({ parentDirectory: home });
            return spillStore.write(content);
          },
        },
      },
    },
  );
  const scripted = createScriptedProvider([
    { toolCalls: [{ name: entry.canonicalName, args: {} }] },
    { text: 'result received' },
  ]);
  const session = new InteractiveSession({
    cwd: home,
    provider: scripted.provider,
    bare: true,
    permissionMode: 'bypassPermissions',
    additionalTools: [tool],
    maxTurns: 3,
  });

  try {
    const handle = await session.submit('call the controlled MCP tool');
    await handle.completed;
    const nextRequest = scripted.requests[1];
    requireCondition(nextRequest !== undefined, 'recording provider did not receive tool result');
    const toolMessage = nextRequest.find((message) => message.role === 'tool');
    requireCondition(toolMessage !== undefined, 'provider request has no tool message');
    const providerText = String(toolMessage.content ?? '');
    requireCondition(providerText.length <= 200, 'provider received an over-limit result');

    if (!overflow) {
      requireCondition(providerText === raw, 'within-limit result was changed');
      requireCondition(spillStore === undefined, 'within-limit result created a spill');
      process.stdout.write('result=admitted; providerBoundRespected=true; spillCreated=false\n');
      return;
    }

    requireCondition(
      /^tool-result:[A-Za-z0-9_-]{22,64}$/u.test(providerText),
      'reference is not opaque',
    );
    requireCondition(
      !JSON.stringify(nextRequest).includes(secret),
      'provider request leaked payload',
    );
    requireCondition(spillStore !== undefined, 'overflow did not create a spill store');
    requireCondition(
      (await spillStore.read(providerText)) === secret,
      'spilled payload was not stored',
    );
    await spillStore.shutdown();
    spillStore = undefined;
    requireCondition(
      !readdirSync(home).some((name) => name.startsWith('robota-tool-results-')),
      'session spill storage was not cleaned',
    );
    process.stdout.write(
      'result=spilled; opaqueReference=true; payloadLeaked=false; cleanupRemoved=true\n',
    );
  } finally {
    await session.shutdown();
    if (spillStore !== undefined) await spillStore.shutdown();
  }
}

run(process.argv[2] ?? '')
  .then(() => {
    rmSync(home, { recursive: true, force: true });
  })
  .catch((error: unknown) => {
    rmSync(home, { recursive: true, force: true });
    process.stderr.write(`failure=${error instanceof Error ? error.name : 'unknown'}\n`);
    process.exitCode = 1;
  });
