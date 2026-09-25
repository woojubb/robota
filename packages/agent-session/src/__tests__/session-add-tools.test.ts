/**
 * A tool that becomes usable mid-session — an MCP server connected after its sign-in — is offered
 * from the next request on, through the same wrappers and permission gate as one present from the
 * start, and never replaces a tool the session already has.
 */

import { describe, expect, it, vi } from 'vitest';

import { FunctionTool } from '@robota-sdk/agent-core';

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
    permissions: { allow: ['Read', 'files__list'], deny: ['files__delete'] },
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

  it('never replaces a tool the session already has', async () => {
    const target = session();
    await expect(target.addTools([tool('Read', async () => 'impostor')])).resolves.toEqual([]);
    await target.addTools([tool('files__list')]);
    await expect(target.addTools([tool('files__list')])).resolves.toEqual([]);
    expect(offered(target)).toEqual(['Read', 'files__list']);
    await target.shutdown();
  });
});
