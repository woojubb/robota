import { describe, expect, it } from 'vitest';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';

import { createDefaultCommandModules } from '../default-command-modules.js';

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

const baseOptions = { cwd: '/tmp', providerDefinitions, providerSettingsAdapter } as const;

function moduleNames(opts: Parameters<typeof createDefaultCommandModules>[0]): string[] {
  return createDefaultCommandModules(opts).modules.map((module) => module.name);
}

describe('createDefaultCommandModules — PRESET-004 module-selection delta', () => {
  // Module `name`s are the stable ICommandModule ids (the `agent-command-*` form).
  const HELP = 'agent-command-help';
  const AGENT = 'agent-command-agent';
  const BACKGROUND = 'agent-command-background';

  it('TC-04: neither enabled nor disabled given → full default set unchanged (no-regression)', () => {
    const names = moduleNames(baseOptions);
    // No-regression: the default set length is the documented 26 modules (SELFHOST-002 added `/plan`).
    expect(names).toHaveLength(26);
    expect(names).toEqual([
      'agent-command-skills',
      'agent-command-help',
      'agent-command-agent',
      'agent-command-permissions',
      'agent-command-mode',
      'agent-command-preset',
      'agent-command-language',
      'agent-command-background',
      'agent-command-goal',
      'agent-command-plan',
      'agent-command-shell',
      'agent-command-editor',
      'agent-command-memory',
      'agent-command-user-local',
      'agent-command-compact',
      'agent-command-context',
      'agent-command-exit',
      'agent-command-session',
      'agent-command-reset',
      'agent-command-rewind',
      'agent-command-schedule',
      'agent-command-statusline',
      'agent-command-plugin',
      'agent-command-settings',
      'agent-command-remote-control',
      'agent-command-provider',
    ]);
  });

  it('TC-01: enabledCommandModules whitelist keeps exactly the listed module names', () => {
    const names = moduleNames({ ...baseOptions, enabledCommandModules: [HELP, AGENT] });
    expect(new Set(names)).toEqual(new Set([HELP, AGENT]));
    expect(names).toHaveLength(2);
  });

  it('TC-02: disabledCommandModules blacklist removes the named module', () => {
    const full = moduleNames(baseOptions);
    const names = moduleNames({ ...baseOptions, disabledCommandModules: [BACKGROUND] });
    expect(names).not.toContain(BACKGROUND);
    expect(names).toHaveLength(full.length - 1);
  });

  it('TC-03: a name in both enabled and disabled is excluded (deny > allow)', () => {
    const names = moduleNames({
      ...baseOptions,
      enabledCommandModules: [HELP, AGENT],
      disabledCommandModules: [AGENT],
    });
    expect(new Set(names)).toEqual(new Set([HELP]));
    expect(names).not.toContain(AGENT);
  });

  it('INFRA-032: an unknown whitelist name yields no module for it AND is reported as unknown', () => {
    const result = createDefaultCommandModules({
      ...baseOptions,
      enabledCommandModules: [HELP, 'does-not-exist'],
    });
    // Known-name filtering is unchanged — only the matched module survives.
    expect(result.modules.map((module) => module.name)).toEqual([HELP]);
    // The unmatched name is surfaced (no longer silently dropped).
    expect(result.unknownModuleNames).toEqual([{ name: 'does-not-exist', kind: 'enabled' }]);
  });

  it('INFRA-032: an unknown disabled name (short form) is reported as unknown', () => {
    const result = createDefaultCommandModules({
      ...baseOptions,
      disabledCommandModules: ['editor'],
    });
    // The short form "editor" matches no module name (agent-command-editor stays enabled)…
    expect(result.modules.map((module) => module.name)).toContain('agent-command-editor');
    // …and is surfaced rather than silently ignored.
    expect(result.unknownModuleNames).toEqual([{ name: 'editor', kind: 'disabled' }]);
  });

  it('INFRA-032: all names matching → unknownModuleNames is empty', () => {
    const result = createDefaultCommandModules({
      ...baseOptions,
      enabledCommandModules: [HELP, AGENT],
      disabledCommandModules: [AGENT],
    });
    expect(result.unknownModuleNames).toEqual([]);
  });
});
