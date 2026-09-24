import { mkdirSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { Session } from '@robota-sdk/agent-session';
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { scriptedSession } from '../index.js';
import type { IHookTypeExecutor, IToolExecutionContext } from '@robota-sdk/agent-core';
import type { IMcpTransportSession } from '@robota-sdk/agent-transport-mcp';

const isolatedHome = vi.hoisted(() => `/tmp/robota-mcp-functional-home-${process.pid}`);
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => isolatedHome,
}));
beforeAll(() => {
  mkdirSync(isolatedHome, { recursive: true });
});
afterAll(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
});
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function connect(session: IMcpTransportSession) {
  const server = await createAgentMcpServer({ name: 'real-session', version: '1', session });
  const [peer, host] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'peer', version: '1' });
  cleanup.push(() => client.close());
  await Promise.all([client.connect(peer), server.connect(host)]);
  return client;
}
function toolSession(permission: 'allow' | 'deny' | 'ask') {
  const hooks: string[] = [];
  const execute = vi.fn(async () => 'x'.repeat(40000));
  const handler = vi.fn(async () => true);
  const hook: IHookTypeExecutor = {
    type: 'command',
    execute: async (_definition, input) => {
      hooks.push(input.hook_event_name);
      return { outcome: 'allow', source: 'command', stdout: '' };
    },
  };
  const group = [{ matcher: '', hooks: [{ type: 'command', command: 'test-hook' }] }];
  const session = new Session({
    cwd: isolatedHome,
    systemMessage: 'MCP test',
    provider: createScriptedProvider([]).provider,
    tools: [
      new FunctionTool(
        {
          name: 'Write',
          description: 'Bounded output',
          parameters: { type: 'object', properties: {} },
        },
        execute,
      ),
    ],
    permissions: {
      allow: permission === 'allow' ? ['Write'] : [],
      deny: permission === 'deny' ? ['Write'] : [],
    },
    permissionHandler: handler,
    hooks: { PreToolUse: group, PostToolUse: group },
    hookTypeExecutors: [hook],
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
  });
  cleanup.push(() => session.shutdown());
  const port: IMcpTransportSession = {
    listRuntimeTools: () => session.listRuntimeTools(),
    invokeRuntimeTool: (name, parameters, options) =>
      session.invokeRuntimeTool(name, parameters, options),
    submit: async () => {
      throw new Error('Submission not used by the runtime policy fixture');
    },
  };
  return { session, port, hooks, execute, handler };
}

describe('in-memory MCP with real session execution', () => {
  it('preserves hooks, permission, truncation, events and error isolation end to end', async () => {
    const allowed = toolSession('allow');
    const events: string[] = [];
    allowed.session.getEventService().subscribe((type) => events.push(type));
    const client = await connect(allowed.port);
    const result = await client.callTool({ name: 'Write' });
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).toContain('truncated');
    expect(JSON.stringify(result).length).toBeLessThan(35000);
    expect(allowed.hooks).toEqual(expect.arrayContaining(['PreToolUse', 'PostToolUse']));
    expect(events.some((type) => type.endsWith('call_complete'))).toBe(true);
    expect(await client.callTool({ name: 'unknown' })).toMatchObject({ isError: true });
    expect(await client.callTool({ name: 'Write' })).toMatchObject({ isError: false });
    for (const permission of ['deny', 'ask'] as const) {
      const fixture = toolSession(permission);
      const denied = await connect(fixture.port);
      expect(await denied.callTool({ name: 'Write' })).toMatchObject({ isError: true });
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(fixture.handler).not.toHaveBeenCalled();
    }
  });

  it('exports projected commands and executes file tools without a model turn', async () => {
    const harness = scriptedSession({
      turns: [],
      commandModules: [
        {
          name: 'test',
          systemCommands: [
            {
              name: 'echo',
              description: 'Echo',
              modelInvocable: true,
              lifecycle: 'blocking',
              execute: async () => ({ success: true, message: 'echoed' }),
            },
            {
              name: 'hidden',
              description: 'Hidden',
              modelInvocable: false,
              lifecycle: 'blocking',
              execute: async () => ({ success: true, message: 'hidden' }),
            },
          ],
        },
      ],
    });
    cleanup.push(() => harness.dispose());
    const client = await connect(harness.session);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('command_echo');
    expect(names).not.toContain('command_hidden');
    expect(names).not.toContain('robota_command_echo');
    const echoed = await client.callTool({ name: 'command_echo', arguments: { args: '' } });
    expect(echoed.isError).toBe(false);
    expect(JSON.stringify(echoed)).toContain('echoed');
    expect(
      await client.callTool({ name: 'Bash', arguments: { command: 'printf mcp > result.txt' } }),
    ).toMatchObject({ isError: false });
    expect(harness.readFile('result.txt')).toBe('mcp');
    expect(harness.requests).toHaveLength(0);
    expect(harness.logEntries().some((entry) => entry.event === 'tool_call')).toBe(true);
  }, 20000);

  it('keeps a cancelled request owned until settlement and isolates a second session', async () => {
    let started!: (signal: AbortSignal) => void;
    const ready = new Promise<AbortSignal>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const hold = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const tool = new FunctionTool(
      {
        name: 'Blocking',
        description: 'Await release',
        parameters: { type: 'object', properties: {} },
      },
      async (_args, context?: IToolExecutionContext) => {
        if (!context?.signal) throw new Error('Missing signal');
        started(context.signal);
        await hold;
        return 'settled';
      },
    );
    const harness = scriptedSession({ turns: [], additionalTools: [tool] });
    cleanup.push(async () => {
      finish();
      await harness.dispose();
    });
    const client = await connect(harness.session);
    const controller = new AbortController();
    const call = client.callTool({ name: 'Blocking' }, undefined, { signal: controller.signal });
    const observed = call.then(
      () => 'unexpected-success',
      () => 'cancelled',
    );
    const signal = await ready;
    controller.abort();
    expect(await observed).toBe('cancelled');
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect(await client.callTool({ name: 'Bash', arguments: { command: 'true' } })).toMatchObject({
      isError: true,
    });
    const independent = await connect(toolSession('allow').port);
    expect(await independent.callTool({ name: 'Write' })).toMatchObject({ isError: false });
    finish();
    await vi.waitFor(() => expect(harness.session.isExecuting()).toBe(false));
    expect(await client.callTool({ name: 'Bash', arguments: { command: 'true' } })).toMatchObject({
      isError: false,
    });
  }, 20000);
});
