/**
 * A tool that becomes usable mid-session — an MCP server connected after its sign-in — is offered
 * from the next request on, through the same wrappers and permission gate as one present from the
 * start, and never replaces a tool the session already has.
 */

import { describe, expect, it, vi } from 'vitest';

import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { Session } from '../session.js';

import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type { ISessionOptions } from '../session-types.js';

function tool(name: string, run: () => Promise<string> = async () => name): FunctionTool {
  return new FunctionTool(
    { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
    run,
  );
}

function session(overrides: Partial<ISessionOptions> = {}): Session {
  return new Session({
    cwd: '/tmp',
    tools: [tool('Read')],
    provider: {
      name: 'test',
      version: '1',
      chat: vi.fn<IAIProvider['chat']>(),
      generateResponse: vi.fn<IAIProvider['generateResponse']>(),
      supportsTools: () => true,
      validateConfig: () => true,
    },
    systemMessage: 'test',
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    permissions: { allow: ['Read', 'files__list', 'files__read'], deny: ['files__delete'] },
    ...overrides,
  });
}

const offered = (target: Session): string[] =>
  target.getOfferedToolSchemas().map((schema) => schema.name);

describe('Session.addTools', () => {
  it('offers an added tool from the next request, and runs it', async () => {
    const target = session();
    await expect(target.addTools([tool('files__list', async () => 'listed')])).resolves.toEqual([
      'files__list',
    ]);
    expect(offered(target)).toEqual(['Read', 'files__list']);
    expect(target.getToolSchemas().map((schema) => schema.name)).toEqual(['Read', 'files__list']);
    await expect(target.invokeRuntimeTool('files__list', {})).resolves.toMatchObject({
      success: true,
    });
    await target.shutdown();
  });

  it('holds an added tool to the permission rules and the session wrappers', async () => {
    const wrapped: string[] = [];
    const target = session({
      wrapAddedTools: (tools: IToolWithEventService[]) => {
        wrapped.push(...tools.map((added) => added.schema.name));
        return tools;
      },
    });
    await target.addTools([tool('files__delete')]);
    expect(wrapped).toEqual(['files__delete']);
    // Denied by name: withheld from the model, like a denied tool present from the start.
    expect(offered(target)).toEqual(['Read']);
    await target.shutdown();
  });

  it('keeps every tool when two additions run at once', async () => {
    const target = session();
    const [first, second] = await Promise.all([
      target.addTools([tool('files__list')]),
      target.addTools([tool('files__read'), tool('files__list')]),
    ]);
    expect(first).toEqual(['files__list']);
    expect(second).toEqual(['files__read']);
    expect(offered(target)).toEqual(['Read', 'files__list', 'files__read']);
    await expect(target.invokeRuntimeTool('files__list', {})).resolves.toMatchObject({
      success: true,
    });
    await expect(target.invokeRuntimeTool('files__read', {})).resolves.toMatchObject({
      success: true,
    });
    await target.shutdown();
  });

  it('holds a tool added during a turn until the next turn starts', async () => {
    const { provider, chatOptions } = createScriptedProvider([
      { toolCalls: [{ name: 'Read', args: {} }] },
      { text: 'read it' },
      { text: 'next turn' },
    ]);
    let added: Promise<readonly string[]> | undefined;
    let target!: Session;
    const read = tool('Read', async () => {
      added = target.addTools([tool('files__list')]);
      await added;
      return 'contents';
    });
    target = session({ tools: [read], provider });
    await target.run('read something');
    await expect(added).resolves.toEqual(['files__list']);
    const names = (call: number): string[] =>
      (chatOptions[call]?.tools ?? []).map((schema) => schema.name);
    // Both rounds of the running turn saw the same list.
    expect(names(0)).toEqual(['Read']);
    expect(names(1)).toEqual(['Read']);
    expect(offered(target)).toEqual(['Read']);
    await target.run('again');
    expect(names(2)).toEqual(['Read', 'files__list']);
    await target.shutdown();
  });

  it('starts a turn only after a tool change in flight has finished', async () => {
    const { provider, chatOptions } = createScriptedProvider([{ text: 'hi' }]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let registering!: () => void;
    const registration = new Promise<void>((resolve) => {
      registering = resolve;
    });
    const target = session({ provider });
    // A slow registration: by the time it runs, the queue of added tools is already empty.
    const agent = (
      target as unknown as { agent: { updateTools: (next: never) => Promise<unknown> } }
    ).agent;
    const updateTools = agent.updateTools.bind(agent);
    agent.updateTools = async (next) => {
      registering();
      await held;
      return updateTools(next);
    };
    const added = target.addTools([tool('files__list')]);
    await registration;
    const turn = target.run('hello');
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([added, turn]);
    expect((chatOptions[0]?.tools ?? []).map((schema) => schema.name)).toEqual([
      'Read',
      'files__list',
    ]);
    await target.shutdown();
  });

  it('never replaces a tool the session already has', async () => {
    const target = session();
    await expect(target.addTools([tool('Read', async () => 'impostor')])).resolves.toEqual([]);
    await target.addTools([tool('files__list')]);
    await expect(target.addTools([tool('files__list')])).resolves.toEqual([]);
    expect(offered(target)).toEqual(['Read', 'files__list']);
    await target.shutdown();
  });
});
