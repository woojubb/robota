import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createStdioAdapter } from '../client/stdio.js';
import { openMcpSession } from '../client/session.js';
import { MCPActivationAdmissionService } from '../mcp-activation.js';
import { MCPDefinitionRegistry } from '../definition/registry.js';

it('reads a 16 MiB raw binary resource through the exact admitted stdio child and observes cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-skills-stdio-'));
  const fixture = fileURLToPath(new URL('./fixtures/skills-mcp-server.mjs', import.meta.url));
  const definition = {
    name: 'skills-stdio',
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
  const transport = adapter.construct(admitted.admitted);
  try {
    const session = await openMcpSession({
      serverId: definition.name,
      protocolVersion: '2026-07-28',
      skills: true,
      transport,
      timeouts: { startupMs: 5000, perCallMs: 5000 },
    });
    try {
      const skill = await session.skills!.get('skill://binary-demo/SKILL.md');
      const verified = await session.skills!.read(skill, skill.uri);
      expect(verified.size).toBe(16 * 1024 * 1024);
      const decoded = Buffer.from(verified.blob!, 'base64');
      expect(decoded.byteLength).toBe(16 * 1024 * 1024);
      expect(decoded.at(0)).toBe(42);
      expect(decoded.at(-1)).toBe(42);
    } finally {
      await session.close();
    }
    expect('closedDirectChild' in transport && transport.closedDirectChild).toBe(true);
  } finally {
    await transport.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
