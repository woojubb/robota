import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { openMcpSession } from '../client/session.js';
import { createStdioAdapter } from '../client/stdio.js';
import { MCPStdioError } from '../client/stdio-transport.js';
import { MCPDefinitionRegistry } from '../definition/registry.js';
import { MCPActivationAdmissionService } from '../mcp-activation.js';

import type { IMCPSession } from '../client/session.js';

const UI_DECLARATION = { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } };

let root: string | undefined;
let session: IMCPSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function open(fixtureName: string, pinned: boolean, apps: boolean): Promise<IMCPSession> {
  root = await mkdtemp(join(tmpdir(), 'mcp-apps-stdio-'));
  const fixture = fileURLToPath(new URL(`./fixtures/${fixtureName}`, import.meta.url));
  const definition = {
    name: 'apps-stdio',
    source: 'project' as const,
    origin: 'fixture',
    transport: 'stdio' as const,
    command: process.execPath,
    args: [fixture],
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
  ).list()[0]!;
  const admission = new MCPActivationAdmissionService();
  admission.approve(activation);
  const adapter = createStdioAdapter({
    admission,
    authority: {
      allowedRoot: root,
      generation: '1',
      executables: [{ command: process.execPath, args: [[fixture]] }],
      environment: { HOME: root },
    },
  });
  const admitted = await adapter.admit({ definition, activation });
  if (!admitted.ok) throw new Error(admitted.reason);
  session = await openMcpSession({
    serverId: definition.name,
    ...(pinned ? { protocolVersion: '2026-07-28' } : {}),
    ...(apps ? { apps: true } : {}),
    transport: adapter.construct(admitted.admitted),
    timeouts: { startupMs: 10_000, perCallMs: 10_000 },
  });
  return session;
}

describe.each([
  ['legacy', 'apps-legacy-stdio-server.mjs', false],
  ['pinned', 'apps-pinned-stdio-server.mjs', true],
] as const)('%s era over stdio — MCP Apps', (_era, fixtureName, pinned) => {
  it('declares the extension to the child only with the opt-in', async () => {
    const withApps = await open(fixtureName, pinned, true);
    const declared = await withApps.readResource('ui://app/caps');
    expect(JSON.parse(String(declared.contents[0]?.['text']))).toMatchObject({
      extensions: UI_DECLARATION,
    });
    await withApps.close();

    const without = await open(fixtureName, pinned, false);
    const bare = await without.readResource('ui://app/caps');
    expect(JSON.parse(String(bare.contents[0]?.['text']))).not.toHaveProperty('extensions');
  }, 30_000);

  it('keeps the view reference of a negotiated child', async () => {
    const opened = await open(fixtureName, pinned, true);
    expect(opened.apps).toBe(true);
    const discovery = await opened.discover({ maxPages: 2, perRequestTimeoutMs: 10_000 });
    expect(discovery.tools.items[0]?.ui).toEqual({
      resourceUri: 'ui://app/view',
      visibility: ['model', 'app'],
    });
  }, 30_000);

  it('masks a failed read as a send failure, with nothing the child said', async () => {
    const opened = await open(fixtureName, pinned, true);
    const failure = await opened.readResource('ui://app/fail').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MCPStdioError);
    expect((failure as MCPStdioError).reason).toBe('send');
    expect(String((failure as Error).message)).not.toContain('secret-from-server');
  }, 30_000);
});
