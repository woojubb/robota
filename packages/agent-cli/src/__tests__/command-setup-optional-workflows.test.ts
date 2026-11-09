import { createTestProductRuntime } from './helpers/product-runtime.js';
/**
 * `/workflows` is bundled into the self-contained agent-cli. The command module comes from
 * `@robota-sdk/workflows/command`, which is compiled into `dist` (no runtime resolution), so the
 * command is ALWAYS registered — both in the monorepo and in a published/packed install.
 *
 * `buildCommandSetup` now returns the product-shell MATERIALS rather than the final module
 * list — `baseCommandModules` (fed to `assembleProduct` as the profile's base) and `fixedCommandModules`
 * (never filtered by the preset delta). The preset delta + its unknown-name diagnostics moved to the shell,
 * where they apply to the base ⊕ pack superset; they are covered in `the product-assembly-equivalence.test.ts`.
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createProductCapabilityPacks, packCommandModuleNames } from '../product/product-profile.js';
import { buildCommandSetup } from '../startup/command-setup.js';

import type { ICommandMCPActivationAdapter } from '@robota-sdk/agent-framework';
import type { IParsedCliArgs } from '../utils/cli-args.js';

/** The packs' root: an unmade path in a private per-run directory, not a fixed name under /tmp. */
const PRIVATE_BASE = mkdtempSync(join(tmpdir(), 'test-product-optional-workflows-'));
afterAll(() => rmSync(PRIVATE_BASE, { recursive: true, force: true }));
const PRODUCT_PACK_COMMAND_MODULE_NAMES = packCommandModuleNames(
  createProductCapabilityPacks({ cwd: join(PRIVATE_BASE, 'workspace') }, createTestProductRuntime()),
);

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

describe('buildCommandSetup — bundled /workflows', () => {
  it('builds a non-empty base command-module set without throwing', () => {
    expect(() => buildCommandSetup('/tmp', MINIMAL_ARGS, { productRuntime: createTestProductRuntime() }, '0.0.0-test')).not.toThrow();
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, { productRuntime: createTestProductRuntime() }, '0.0.0-test');
    expect(setup.baseCommandModules.length).toBeGreaterThan(0);
  });

  it('always includes exactly one fully-formed /workflows module (bundled, not optional)', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, { productRuntime: createTestProductRuntime() }, '0.0.0-test');
    const workflows = setup.fixedCommandModules.filter((m) => m.name === 'agent-command-workflows');
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.systemCommands?.some((c) => c.name === 'workflows')).toBe(true);
  });

  it('does not expose a second test-product-dag executable from a workspace package', () => {
    const packagesRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const binOwners = readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const manifestPath = join(packagesRoot, entry.name, 'package.json');
        if (!existsSync(manifestPath)) return [];
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          bin?: Record<string, string> | string;
        };
        return typeof manifest.bin === 'object' && manifest.bin !== null &&
          'test-product-dag' in manifest.bin
          ? [entry.name]
          : [];
      });

    expect(binOwners).toEqual([]);
  });

  it('forwards the optional MCP activation adapter without interpreting its policy', () => {
    const adapter: ICommandMCPActivationAdapter = {
      list: () => [],
      approve: () => ({
        serverId: 'server-1',
        source: 'project',
        status: 'pending',
        allowed: false,
        reason: 'pending',
        provenanceId: 'project-1',
        definitionFingerprint: 'definition-1',
        securityIdentity: 'identity-1',
      }),
      reject: () => ({
        serverId: 'server-1',
        source: 'project',
        status: 'rejected',
        allowed: false,
        reason: 'rejected',
        provenanceId: 'project-1',
        definitionFingerprint: 'definition-1',
        securityIdentity: 'identity-1',
      }),
      revoke: () => ({
        serverId: 'server-1',
        source: 'project',
        status: 'revoked',
        allowed: false,
        reason: 'revoked',
        provenanceId: 'project-1',
        definitionFingerprint: 'definition-1',
        securityIdentity: 'identity-1',
      }),
    };

    const setup = buildCommandSetup(
      '/tmp',
      MINIMAL_ARGS,
      { productRuntime: createTestProductRuntime(), mcpActivationAdapter: adapter },
      '0.0.0-test',
    );

    expect(setup.commandHostAdapters.mcpActivation).toBe(adapter);
  });
});

describe('buildCommandSetup — pack-supplied modules are excluded from the base', () => {
  it('omits every pack-supplied module name so the pack is their single source', () => {
    const setup = buildCommandSetup(
      '/tmp',
      MINIMAL_ARGS,
      { productRuntime: createTestProductRuntime() },
      '0.0.0-test',
      PRODUCT_PACK_COMMAND_MODULE_NAMES,
    );
    const baseNames = setup.baseCommandModules.map((m) => m.name);

    expect(PRODUCT_PACK_COMMAND_MODULE_NAMES.length).toBeGreaterThan(0);
    for (const name of PRODUCT_PACK_COMMAND_MODULE_NAMES) {
      expect(baseNames).not.toContain(name);
    }
  });

  it('keeps every default module when no pack names are excluded', () => {
    const withExclusion = buildCommandSetup(
      '/tmp',
      MINIMAL_ARGS,
      { productRuntime: createTestProductRuntime() },
      '0.0.0-test',
      PRODUCT_PACK_COMMAND_MODULE_NAMES,
    );
    const withoutExclusion = buildCommandSetup('/tmp', MINIMAL_ARGS, { productRuntime: createTestProductRuntime() }, '0.0.0-test');

    // The exclusion removes exactly the pack-supplied names the default set builds: `/shell` and
    // `/editor` live on `agent-product/command/node` and only the pack supplies them, so it has none to remove.
    const excludedFromDefaults = withoutExclusion.baseCommandModules.filter((module) =>
      PRODUCT_PACK_COMMAND_MODULE_NAMES.includes(module.name),
    );
    expect(excludedFromDefaults.length).toBeGreaterThan(0);
    expect(withoutExclusion.baseCommandModules.length).toBe(
      withExclusion.baseCommandModules.length + excludedFromDefaults.length,
    );
  });
});
