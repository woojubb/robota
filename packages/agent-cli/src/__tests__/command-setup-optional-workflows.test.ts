/**
 * INFRA-028: `/workflows` is bundled into the self-contained agent-cli. The command module comes from
 * `@robota-sdk/agent-command-workflows`, which is compiled into `dist` (no runtime resolution), so the
 * command is ALWAYS registered — both in the monorepo and in a published/packed install.
 */
import { describe, it, expect } from 'vitest';

import { buildCommandSetup } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

describe('buildCommandSetup — bundled /workflows (INFRA-028)', () => {
  it('builds a non-empty command-module set without throwing', () => {
    expect(() => buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test')).not.toThrow();
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    expect(setup.commandModules.length).toBeGreaterThan(0);
  });

  it('always includes exactly one fully-formed /workflows module (bundled, not optional)', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    const workflows = setup.commandModules.filter((m) => m.name === 'agent-command-workflows');
    expect(workflows).toHaveLength(1);
    expect(workflows[0].systemCommands?.some((c) => c.name === 'workflows')).toBe(true);
  });
});

describe('buildCommandSetup — unknown preset command-module names (INFRA-032)', () => {
  it('forwards no unknowns when the preset selection is absent', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    expect(setup.unknownModuleNames).toEqual([]);
  });

  it('forwards an unmatched disabled short-form name so the CLI can surface a notice', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test', {
      disabledCommandModules: ['editor'],
    });
    // "editor" is the short form; the built module name is agent-command-editor → unmatched.
    expect(setup.unknownModuleNames).toEqual([{ name: 'editor', kind: 'disabled' }]);
    // Non-fatal: the module set is still built and the workflows module is still present.
    expect(setup.commandModules.length).toBeGreaterThan(0);
  });

  it('forwards no unknowns when every selection name matches a built module', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test', {
      disabledCommandModules: ['agent-command-editor'],
    });
    expect(setup.unknownModuleNames).toEqual([]);
  });
});
