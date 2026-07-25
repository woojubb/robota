/**
 * INFRA-028: `/workflows` is bundled into the self-contained agent-cli. The command module comes from
 * `@robota-sdk/agent-command-workflows`, which is compiled into `dist` (no runtime resolution), so the
 * command is ALWAYS registered — both in the monorepo and in a published/packed install.
 *
 * ARCH-005 S2: `buildCommandSetup` now returns the product-shell MATERIALS rather than the final module
 * list — `baseCommandModules` (fed to `assembleProduct` as the profile's base) and `fixedCommandModules`
 * (never filtered by the preset delta). The preset delta + its unknown-name diagnostics moved to the shell,
 * where they apply to the base ⊕ pack superset; they are covered in `robota-assembly-equivalence.test.ts`.
 */
import { describe, it, expect } from 'vitest';

import { ROBOTA_PACK_COMMAND_MODULE_NAMES } from '../product/robota-profile.js';
import { buildCommandSetup } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

describe('buildCommandSetup — bundled /workflows (INFRA-028)', () => {
  it('builds a non-empty base command-module set without throwing', () => {
    expect(() => buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test')).not.toThrow();
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    expect(setup.baseCommandModules.length).toBeGreaterThan(0);
  });

  it('always includes exactly one fully-formed /workflows module (bundled, not optional)', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    const workflows = setup.fixedCommandModules.filter((m) => m.name === 'agent-command-workflows');
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.systemCommands?.some((c) => c.name === 'workflows')).toBe(true);
  });
});

describe('buildCommandSetup — pack-supplied modules are excluded from the base (ARCH-005 S2)', () => {
  it('omits every pack-supplied module name so the pack is their single source', () => {
    const setup = buildCommandSetup(
      '/tmp',
      MINIMAL_ARGS,
      {},
      '0.0.0-test',
      ROBOTA_PACK_COMMAND_MODULE_NAMES,
    );
    const baseNames = setup.baseCommandModules.map((m) => m.name);

    expect(ROBOTA_PACK_COMMAND_MODULE_NAMES.length).toBeGreaterThan(0);
    for (const name of ROBOTA_PACK_COMMAND_MODULE_NAMES) {
      expect(baseNames).not.toContain(name);
    }
  });

  it('keeps every default module when no pack names are excluded', () => {
    const withExclusion = buildCommandSetup(
      '/tmp',
      MINIMAL_ARGS,
      {},
      '0.0.0-test',
      ROBOTA_PACK_COMMAND_MODULE_NAMES,
    );
    const withoutExclusion = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');

    expect(withoutExclusion.baseCommandModules.length).toBe(
      withExclusion.baseCommandModules.length + ROBOTA_PACK_COMMAND_MODULE_NAMES.length,
    );
  });
});
