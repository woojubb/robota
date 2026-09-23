/** BEHAVIOR-2437 TC-05 — registration, the descriptor, and the verb parse through the real session. */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createDefaultCommandModules } from '../../default/default-command-modules.js';
import { createHelpCommandModule } from '../../help/help-command-module.js';
import {
  createGitCommandEntry,
  createGitCommandModule,
  executeGitCommand,
} from '../git-command-module.js';

import { exited, fakeGitPort } from './fake-git-port.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    defaults: { model: 'claude-sonnet-4-6', apiKey: '$ENV:ANTHROPIC_API_KEY' },
    setupSteps: [{ key: 'apiKey', title: 'anthropic API key', masked: true }],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];
const providerSettingsAdapter: IProviderCommandSettingsAdapter = {
  readMergedSettings: () => ({}) as TProviderSettingsDocument,
  readTargetSettings: () => ({}) as TProviderSettingsDocument,
  writeTargetSettings: () => undefined,
};
const BASE_OPTIONS = { cwd: '/tmp', providerDefinitions, providerSettingsAdapter } as const;

const STATUS_FIXTURE = '# branch.head main\0? scratch.log\0';

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('the /git descriptor', () => {
  it('is host-only, with the three verbs as descriptive subcommands', () => {
    const entry = createGitCommandEntry();
    expect(entry.name).toBe('git');
    expect(entry.modelInvocable).toBe(false);
    expect(entry.subcommands?.map((s) => s.name)).toEqual(['status', 'diff', 'commit']);
    const module = createGitCommandModule({ port: fakeGitPort({}) });
    expect(module.name).toBe('agent-command-git');
    expect(module.systemCommands?.[0]).toMatchObject({
      name: 'git',
      requiresPermission: true,
      modelInvocable: false,
      lifecycle: 'blocking',
    });
  });

  it('is in the base list, and the name `status` is registered nowhere', () => {
    const { modules } = createDefaultCommandModules(BASE_OPTIONS);
    expect(modules.map((m) => m.name)).toContain('agent-command-git');
    const names = modules.flatMap((m) => (m.systemCommands ?? []).map((c) => c.name));
    expect(names).toContain('git');
    expect(names).not.toContain('status');
  });
});

describe('executeGitCommand verb parse', () => {
  const context = { getCwd: () => '/r', getUserInteraction: () => undefined };

  it('routes status, refuses arguments to it, and refuses unknown or missing verbs', async () => {
    const port = fakeGitPort({ 'status --porcelain=v2 -z --branch': exited(STATUS_FIXTURE) });
    expect((await executeGitCommand(context, '  status ', port)).message).toContain(
      'On branch main',
    );
    expect((await executeGitCommand(context, 'status extra', port)).success).toBe(false);
    const unknown = await executeGitCommand(context, 'push', port);
    expect(unknown.success).toBe(false);
    expect(unknown.message).toContain('push');
    expect((await executeGitCommand(context, '', port)).message).toContain('Usage: /git');
    expect(port.calls).toHaveLength(1);
  });
});

describe('/git through the real session', () => {
  it('/help lists /git, and /git status answers through the injected port', async () => {
    const port = fakeGitPort({ 'status --porcelain=v2 -z --branch': exited(STATUS_FIXTURE) });
    h = scriptedSession({
      turns: [{ text: 'unused' }],
      commandModules: [createHelpCommandModule(), createGitCommandModule({ port })],
    });
    const help = await h.command('help');
    expect(help?.message).toContain('/git');
    const status = await h.command('git', 'status');
    expect(status?.success).toBe(true);
    expect(status?.message).toContain('untracked (1): scratch.log');
  });
});
