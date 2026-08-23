/**
 * SEC-008 — an MCP peer is remote, and the commands it may call are not every command.
 *
 * Two defects, both about the same missing distinction: what reaches the MCP adapter had already
 * lost the tags that say who may invoke a command, and what left it had lost the tag that says who
 * asked.
 *
 * 1. `listCommands()` dropped `modelInvocable`, so a command explicitly marked NOT model-invocable
 *    (`plugin` is one) was registered as an MCP tool and became callable by the peer's model.
 * 2. `executeCommand` was called with no `source`, which defaults to `'user'` — the local operator.
 *    A remote peer was attributed as the person at the keyboard, and the `'remote'` policy seam that
 *    exists precisely to treat those differently was never consulted.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import { describe, expect, it, vi } from 'vitest';

import { createAgentMcpServer } from '../mcp-server.js';

/**
 * Built on the PUBLISHED conformant double rather than a cast.
 *
 * A cast to `IInteractiveSession` is a partial re-implementation nothing checks against the real
 * contract — it compiles whatever it happens to contain, so a member the contract gains later is
 * simply absent here and the suite keeps passing. The double is checked; overrides only replace what
 * this file actually cares about.
 */
function createSession(overrides: Partial<IInteractiveSession> = {}): IInteractiveSession {
  return createTestInteractiveSession({
    executeCommand: vi.fn().mockResolvedValue({ message: 'ran', success: true }),
    listCommands: () => [
      { name: 'clear', description: 'Clear history', modelInvocable: true },
      // The one the model must not be handed. `plugin` installs and enables code, which is why it
      // carries `modelInvocable: false` in the first place.
      { name: 'plugin', description: 'Manage plugins', modelInvocable: false },
    ],
    ...overrides,
  });
}

async function connect(session: IInteractiveSession): Promise<Client> {
  const server = createAgentMcpServer({ name: 'test-agent', version: '1.0.0', session });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('SEC-008: what an MCP peer may call, and as whom', () => {
  it('does not offer a command the model is not allowed to invoke', async () => {
    const client = await connect(createSession());

    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names, 'a modelInvocable:false command was offered to the peer').not.toContain(
      'command_plugin',
    );
    // The allowed one must still be there, or the fix is "offer nothing", which is not a fix.
    expect(names).toContain('command_clear');
  });

  it('attributes the call to a REMOTE source, not to the local operator', async () => {
    const executeCommand = vi.fn().mockResolvedValue({ message: 'ran', success: true });
    const client = await connect(createSession({ executeCommand }));

    await client.callTool({ name: 'command_clear', arguments: { args: '' } });

    expect(executeCommand).toHaveBeenCalledWith('clear', '', 'remote');
  });

  it('refuses a command the peer asks for anyway', async () => {
    // Not offering a tool is not the same as refusing it: a peer can call a name it was never given.
    // The list is the advertisement; this is the gate.
    const executeCommand = vi.fn().mockResolvedValue({ message: 'ran', success: true });
    const client = await connect(createSession({ executeCommand }));

    const result = await client.callTool({
      name: 'command_plugin',
      arguments: { args: 'install x' },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(executeCommand, 'the command ran despite never being offered').not.toHaveBeenCalled();
  });
});
