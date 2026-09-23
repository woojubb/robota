/** SEC-008 / MCP-006: the peer can reach only canonical, policy-wrapped tools. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentMcpServer } from '../mcp-server.js';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
async function connect() {
  const session = createTestInteractiveSession({
    listRuntimeTools: async () => [
      {
        name: 'robota_command_clear',
        description: 'Clear history',
        parameters: { type: 'object', properties: {} },
      },
    ],
    invokeRuntimeTool: vi.fn().mockResolvedValue({ success: true, result: 'ran' }),
    executeCommand: vi.fn(),
    listCommands: vi.fn(),
  });
  const server = await createAgentMcpServer({ name: 'test', version: '1', session });
  const [peer, host] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'peer', version: '1' });
  clients.push(client);
  await Promise.all([client.connect(peer), server.connect(host)]);
  return { session, client };
}

describe('canonical command admission', () => {
  it('never constructs a second command catalog or invokes commands directly', async () => {
    const { session, client } = await connect();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('robota_command_clear');
    expect(names).not.toContain('robota_command_plugin');
    expect(names).not.toContain('command_clear');
    await client.callTool({ name: 'robota_command_clear' });
    expect(session.invokeRuntimeTool).toHaveBeenCalledOnce();
    expect(session.listCommands).not.toHaveBeenCalled();
    expect(session.executeCommand).not.toHaveBeenCalled();
  });

  it('refuses an unregistered command even when the peer guesses its canonical name', async () => {
    const { session, client } = await connect();
    const result = await client.callTool({
      name: 'robota_command_plugin',
      arguments: { args: 'install x' },
    });
    expect(result).toMatchObject({ isError: true });
    expect(session.invokeRuntimeTool).not.toHaveBeenCalled();
    expect(session.executeCommand).not.toHaveBeenCalled();
  });
});
