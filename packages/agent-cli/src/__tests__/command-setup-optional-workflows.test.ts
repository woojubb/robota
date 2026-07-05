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
