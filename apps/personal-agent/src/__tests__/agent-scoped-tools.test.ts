/**
 * A session can be given tools of its own in place of the agent's tools of the same name, so a launched
 * run reads pages through a browser made to record what it returns. The replacement can only be of a
 * tool the agent has and the session is offered, and it is the replacement that runs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBrowserTools } from '@robota-sdk/agent-product/personal';
import { afterEach, describe, expect, it } from 'vitest';

import { createPersonalAgent } from '../agent.js';
import { createProviderFromProfile } from '../provider.js';
import { PAGE, stubBrowser } from './launch-world.js';
import { startScriptedModel } from './scripted-model.js';

import type { IScriptedModel } from './scripted-model.js';

const page = { url: PAGE, title: 'Shipping', text: 'Free shipping', marks: [] };
const READING = ['BrowserOpen', 'BrowserView'];

let model: IScriptedModel | undefined;
const directories: string[] = [];
afterEach(async () => {
  await model?.close();
  model = undefined;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function agentWith(original: ReturnType<typeof stubBrowser>) {
  model = await startScriptedModel();
  const stateDir = mkdtempSync(join(tmpdir(), 'agent-scoped-tools-'));
  directories.push(stateDir);
  return createPersonalAgent({
    stateDir,
    provider: createProviderFromProfile(
      { type: 'openai', model: 'scripted-model', baseURL: model.baseURL, apiKeyEnv: 'KEY' },
      { KEY: 'scripted-key' },
    ),
    tools: createBrowserTools(original.port),
  });
}

const reading = (scoped: ReturnType<typeof stubBrowser>) =>
  createBrowserTools(scoped.port).filter((tool) => READING.includes(tool.getName()));

const options = {
  sessionName: 'Goal: read',
  instructions: 'Read the page.',
  permissionMode: 'plan',
  onlyTools: READING,
} as const;

describe('a session’s own tools', () => {
  it('runs the replacement in place of the agent’s tool of the same name, and not the agent’s', async () => {
    const original = stubBrowser({ [PAGE]: page });
    const scoped = stubBrowser({ [PAGE]: page });
    const agent = await agentWith(original);
    const session = agent.openSession({ ...options, scopedTools: reading(scoped) });
    model!.script({ tool: 'BrowserOpen', args: { url: PAGE } }, { text: 'Read it.' });
    try {
      const handle = await session.submit('Open the page.');
      await handle.completed;
    } finally {
      await session.shutdown();
    }
    expect(scoped.calls).toEqual([`open ${PAGE}`]);
    expect(original.calls).toEqual([]);
  });

  it('leaves the agent’s own tool in place for a session that is given none', async () => {
    const original = stubBrowser({ [PAGE]: page });
    const agent = await agentWith(original);
    const session = agent.openSession(options);
    model!.script({ tool: 'BrowserOpen', args: { url: PAGE } }, { text: 'Read it.' });
    try {
      await (
        await session.submit('Open the page.')
      ).completed;
    } finally {
      await session.shutdown();
    }
    expect(original.calls).toEqual([`open ${PAGE}`]);
  });

  it.each([
    ['a tool the agent does not have', { onlyTools: [...READING, 'Nothing'], names: ['Nothing'] }],
    ['a tool the session is not offered', { onlyTools: ['BrowserView'], names: ['BrowserOpen'] }],
    [
      'a tool the session denies',
      { onlyTools: READING, deniedTools: ['BrowserOpen'], names: ['BrowserOpen'] },
    ],
    ['a tool named twice', { onlyTools: READING, names: ['BrowserOpen', 'BrowserOpen'] }],
  ] as const)('refuses a replacement for %s', async (_name, change) => {
    const original = stubBrowser({ [PAGE]: page });
    const scoped = stubBrowser({ [PAGE]: page });
    const agent = await agentWith(original);
    const tools = reading(scoped);
    const named = change.names.map((name) => {
      const tool = tools.find((candidate) => candidate.getName() === name) ?? tools[0]!;
      return Object.create(tool, { getName: { value: () => name } }) as (typeof tools)[number];
    });
    expect(() =>
      agent.openSession({
        ...options,
        onlyTools: [...change.onlyTools],
        ...('deniedTools' in change && { deniedTools: [...change.deniedTools] }),
        scopedTools: named,
      }),
    ).toThrow(/scoped tool must replace exactly one tool the session is offered/u);
  });
});
