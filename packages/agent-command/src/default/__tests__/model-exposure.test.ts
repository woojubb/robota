/**
 * What of the built-in command set the MODEL is offered, and what it is told.
 *
 * Pins, per command: offered or not, the exact model-facing descriptor, and that a user-only
 * subcommand is neither offered nor runnable. The invariant behind it: trust, credential and
 * permission-widening actions are never model-invocable. The reasons for each decision sit beside
 * each command's entry.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { createDoctorCommandModule } from '../../doctor/index.js';
import { createKeybindingsCommandModule } from '../../keybindings/index.js';
import { createThemeCommandModule } from '../../theme/index.js';
import { createDoctorFixture } from '../../doctor/__tests__/doctor-fixture.js';
import { createDefaultCommandModules } from '../default-command-modules.js';

import type { IDoctorFixture } from '../../doctor/__tests__/doctor-fixture.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IProviderCommandSettingsAdapter,
  ISystemCommand,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import type { IThemeCataloguePort } from '@robota-sdk/agent-interface-command';

const providerDefinitions: readonly IProviderDefinition[] = [];
const providerSettingsAdapter: IProviderCommandSettingsAdapter = {
  readMergedSettings: () => ({}) as TProviderSettingsDocument,
  readTargetSettings: () => ({}) as TProviderSettingsDocument,
  writeTargetSettings: () => undefined,
};
const themeCataloguePort: IThemeCataloguePort = {
  listThemes: () => [],
  getTheme: () => undefined,
  getAppearance: () => ({
    settings: { theme: 'dark', syntaxHighlighting: true, reducedMotion: false },
  }),
};

const fixtures: IDoctorFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

/** Every built-in command, including the ones only registered when their host port exists. */
function allBuiltInCommands(): ISystemCommand[] {
  const fixture = createDoctorFixture({ env: {} });
  fixtures.push(fixture);
  const { modules } = createDefaultCommandModules({
    cwd: '/tmp',
    userLocalStorageRoot: '/tmp/robota-test',
    providerDefinitions,
    providerSettingsAdapter,
  });
  return [
    ...modules,
    createKeybindingsCommandModule({ ensureFile: async () => '/tmp/keybindings.json' }),
    createThemeCommandModule(themeCataloguePort),
    createDoctorCommandModule(fixture.inputs, fixture.deps),
  ].flatMap((module) => [...(module.systemCommands ?? [])]);
}

/** Each command with its `execute` replaced, so a test can see whether it ran at all. */
function spiedExecutor(): {
  executor: SystemCommandExecutor;
  executed: ReturnType<typeof vi.fn>;
} {
  const executed = vi.fn(() => ({ success: true, message: 'ran' }));
  const commands = allBuiltInCommands().map((command) => ({ ...command, execute: executed }));
  return { executor: new SystemCommandExecutor(commands), executed };
}

/** Offered to the model, each for a reason given beside its entry. */
const MODEL_INVOCABLE = [
  'agent',
  'compact',
  'context',
  'cost',
  'loop',
  'mcp',
  'memory',
  'monitor',
  'schedule',
  'skills',
];

/** Whole commands the model is never offered. */
const USER_ONLY_COMMANDS = [
  // Trust decisions.
  'plugin',
  'reload-plugins',
  'remote-control',
  // Account and credential actions.
  'provider',
  // Permission widening or permission-mode changes.
  'mode',
  'permissions',
  'sandbox',
  'preset',
  'plan',
  'goal',
  'cd',
  // Crossing into another session, machine or process the user owns.
  'peers',
  'handoff',
  'fork',
  'shell',
  'git',
  // Exits and destructive session changes.
  'exit',
  'clear',
  'reset',
  'rewind',
  'resume',
  // UI-only preferences, and views the user reads.
  'advisor',
  'effort',
  'language',
  'output-style',
  'statusline',
  'theme',
  'keybindings',
  'settings',
  'editor',
  'rename',
  'help',
  'background',
  'doctor',
  'user-local',
  'validate-session',
];

/** User-only subcommands of commands the model IS offered. `login` is refused before it exists. */
const USER_ONLY_SUBCOMMANDS: Record<string, readonly string[]> = {
  mcp: ['approve', 'reject', 'revoke', 'logout', 'login', 'list'],
  memory: ['approve', 'reject'],
  context: ['add', 'remove', 'clear', 'auto'],
  cost: ['budget'],
};

describe('built-in commands offered to the model', () => {
  it('offers exactly the model-invocable set', () => {
    const { executor } = spiedExecutor();
    const offered = executor
      .listModelInvocableCommands()
      .map((descriptor) => descriptor.name)
      .sort();
    expect(offered).toEqual([...MODEL_INVOCABLE].sort());
  });

  it('covers every built-in command with a decision', () => {
    const names = allBuiltInCommands()
      .map((command) => command.name)
      .sort();
    expect(names).toEqual([...MODEL_INVOCABLE, ...USER_ONLY_COMMANDS].sort());
  });

  it('describes every offered command for the model: what, when, and what it returns', () => {
    for (const command of allBuiltInCommands().filter((c) => c.modelInvocable === true)) {
      expect(command.modelDescription, command.name).toBeDefined();
      expect(command.modelDescription, command.name).toMatch(/\bUse\b|\bBefore\b|\bWhen\b/);
      expect(command.modelDescription, command.name).toMatch(/\b[Rr]eturns\b/);
    }
  });

  it('pins the descriptor each offered command gets', () => {
    const { executor } = spiedExecutor();
    const descriptors = Object.fromEntries(
      executor
        .listModelInvocableCommands()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((descriptor) => [descriptor.name, descriptor]),
    );
    expect(descriptors).toMatchSnapshot();
  });

  it('never offers or runs a user-only command', async () => {
    const { executor, executed } = spiedExecutor();
    const host = createTestCommandHost();
    for (const name of USER_ONLY_COMMANDS) {
      expect(executor.isModelInvocable(name), name).toBe(false);
      expect(await executor.executeModelInvocable(name, host, ''), name).toBeNull();
    }
    expect(executed).not.toHaveBeenCalled();
  });

  it('never offers a user-only subcommand, and refuses it before the command runs', async () => {
    const { executor, executed } = spiedExecutor();
    const host = createTestCommandHost();
    const descriptors = executor.listModelInvocableCommands();
    for (const [name, subcommands] of Object.entries(USER_ONLY_SUBCOMMANDS)) {
      const descriptor = descriptors.find((candidate) => candidate.name === name);
      const offeredBlock = descriptor?.description.split('Subcommands you may run')[1] ?? '';
      for (const sub of subcommands) {
        expect(descriptor?.argumentHint ?? '', `${name} ${sub}`).not.toMatch(
          new RegExp(`\\b${sub}\\b`),
        );
        expect(offeredBlock, `${name} ${sub}`).not.toContain(`- ${sub}:`);
        const result = await executor.executeModelInvocable(name, host, `${sub} some-arg`);
        expect(result?.success, `${name} ${sub}`).toBe(false);
      }
    }
    expect(executed).not.toHaveBeenCalled();
  });

  it('runs the read-only subset for the model', async () => {
    const { executor, executed } = spiedExecutor();
    const host = createTestCommandHost();
    for (const [name, args] of [
      ['mcp', ''],
      ['mcp', 'status'],
      ['memory', 'list'],
      ['context', ''],
      ['context', 'list'],
      ['cost', ''],
    ] as const) {
      expect((await executor.executeModelInvocable(name, host, args))?.message).toBe('ran');
    }
    expect(executed).toHaveBeenCalledTimes(6);
  });

  it('skips the by-name prompt only where the model reaches nothing that needs it', () => {
    const { executor } = spiedExecutor();
    const byName = Object.fromEntries(
      executor.listModelInvocableCommands().map((d) => [d.name, d.requiresPermission]),
    );
    // `/mcp`: the model reaches only `status`. `/monitor`: its command is decided by the shell
    // gate instead (monitor-model-permission-functional.test.ts).
    expect(byName.mcp).toBe(false);
    expect(byName.monitor).toBe(false);
    // Neither becomes read-only for the user or a remote read-only policy.
    for (const name of ['mcp', 'monitor']) {
      const command = executor.getCommand(name)!;
      expect(executor.resolveRequiresPermission(command), name).toBe(true);
    }
  });
});
