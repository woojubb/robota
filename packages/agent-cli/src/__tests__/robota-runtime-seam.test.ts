/**
 * ARCH-007 — `robota` consumes the composition kernel's RUNTIME SEAM, not just its materials.
 *
 * The ARCH-005 S2 disclosure (B1) was that `cli.ts` passed the assembled materials into
 * `renderApp` / `runPrintMode` / `runServeMode` by hand and never called
 * `product.buildRuntimeOptions` — so the kernel's OVERLAY (pack tools → `additionalTools`, pack
 * subagents → `agentDefinitions`, the default preset's `permissionMode`) was exercised only by tests
 * and by external Mode-A consumers, never by the reference product.
 *
 * These tests pin the seam through the SHIPPED helper (`buildRobotaRuntimeOptions`) that `cli.ts`
 * actually calls — never a re-implementation of it. That is the S2 F4 lesson: an equivalence gate that
 * re-derives the shipped logic tests the test, not the product.
 */

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { DEFAULT_AGENT_NAME, createPresetRegistry } from '@robota-sdk/agent-preset';
import { assembleProduct } from '@robota-sdk/agent-product';
import { describe, expect, it } from 'vitest';

import {
  buildRobotaRuntimeOptions,
  selectProductCommandModules,
} from '../product/robota-plumbing.js';
import {
  createRobotaPacks,
  createRobotaProfile,
  packCommandModuleNames,
} from '../product/robota-profile.js';
import { buildCommandSetup } from '../startup/command-setup.js';
import { resolveShellPreset } from '../startup/preset-selection.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IPreset } from '@robota-sdk/agent-preset';

const SEAM_CWD = '/tmp/runtime-seam';
const ROBOTA_PACKS = createRobotaPacks({ cwd: SEAM_CWD });
const ROBOTA_PACK_COMMAND_MODULE_NAMES = packCommandModuleNames(ROBOTA_PACKS);

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

/** The ten coding tools `pack-coding` contributes — pinned so a drift fails here, not silently. */
const CODING_TOOL_NAMES = [
  'Shell',
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
];

interface IProbeOverrides {
  packs?: 'default' | 'none';
  permissionMode?: 'default' | 'bypassPermissions' | 'acceptEdits' | 'plan';
  defaultPresetId?: string;
  presets?: readonly IPreset[];
}

/** Drive the assembly exactly as `startCli` does — same shipped helpers, same order. */
function robotaProduct(overrides: IProbeOverrides = {}) {
  const { providerDefinitions, baseCommandModules, fixedCommandModules } = buildCommandSetup(
    '/tmp/runtime-seam',
    MINIMAL_ARGS,
    {},
    '0.0.0-test',
    ROBOTA_PACK_COMMAND_MODULE_NAMES,
  );

  const profile = createRobotaProfile({
    version: '0.0.0-test',
    agentName: DEFAULT_AGENT_NAME,
    providerDefinitions,
    provider: createScriptedProvider([{ text: 'ok' }]).provider,
    // ARCH-008: the SHIPPED shell resolution (registry + id + override context as one value), exactly as
    // `startCli` builds it — never a hand-rolled registry, which would test the test.
    preset: resolveShellPreset(
      overrides.presets ?? [],
      {
        ...MINIMAL_ARGS,
        ...(overrides.defaultPresetId !== undefined ? { preset: overrides.defaultPresetId } : {}),
      } as IParsedCliArgs,
      undefined,
    ),
    baseCommandModules,
    packs: ROBOTA_PACKS,
    backgroundTaskRunners: [],
    subagentRunnerFactory: (() => {
      throw new Error('not used');
    }) as never,
    transports: { startAll: async () => {}, stopAll: async () => {} } as never,
  });

  // The pack-removal probe: strip the packs from the profile the shell built, changing nothing else.
  return {
    product: assembleProduct(overrides.packs === 'none' ? { ...profile, packs: [] } : profile),
    fixedCommandModules,
  };
}

/** Route the assembled product through the kernel's runtime seam, as `startCli` does. */
function robotaRuntimeOptions(overrides: IProbeOverrides = {}) {
  const { product, fixedCommandModules } = robotaProduct(overrides);

  return buildRobotaRuntimeOptions({
    product,
    cwd: '/tmp/runtime-seam',
    provider: createScriptedProvider([{ text: 'ok' }]).provider,
    selectedCommandModules: selectProductCommandModules(product, fixedCommandModules, {}),
    ...(overrides.permissionMode !== undefined ? { permissionMode: overrides.permissionMode } : {}),
  });
}

describe('ARCH-007 — the kernel overlay is robota’s single assembly path', () => {
  it('carries the pack SUBAGENTS through the kernel overlay, not a hand-threaded field', () => {
    expect(robotaRuntimeOptions().agentDefinitions.map((a) => a.name)).toEqual([
      'general-purpose',
      'Explore',
      'Plan',
    ]);
  });

  it('carries the pack TOOLS through the kernel overlay as additionalTools', () => {
    expect(robotaRuntimeOptions().toolOptions.additionalTools.map((t) => t.getName())).toEqual(
      CODING_TOOL_NAMES,
    );
  });

  it('SUPPRESSES the framework default tier so the packs are the SOLE source of tools (ARCH-006)', () => {
    // `defaultTools: []` REPLACES `createDefaultTools()`. Without it the framework would still contribute
    // its own ten tools and the pack's would merely dedupe away — the pack would be decorative.
    expect(robotaRuntimeOptions().toolOptions.defaultTools).toEqual([]);
  });

  it('removing the coding pack removes its TOOLS and SUBAGENTS from robota’s runtime options', () => {
    const withoutPack = robotaRuntimeOptions({ packs: 'none' });

    expect(withoutPack.toolOptions.additionalTools).toEqual([]);
    expect(withoutPack.agentDefinitions).toEqual([]);
    // …and the framework tier stays suppressed, so the product genuinely has NO coding tools left.
    expect(withoutPack.toolOptions.defaultTools).toEqual([]);
  });

  it('gives robota the PACK’s cwd-scoped tools, not the framework defaults', async () => {
    // The identity check that makes the axis real: robota's `Read` is the instance `pack-coding` built
    // with the shell's cwd, so it DENIES a path outside it. A framework default built with a different
    // cwd — or, worse, a context-free pack instance — would not.
    const read = robotaRuntimeOptions().toolOptions.additionalTools.find(
      (t) => t.getName() === 'Read',
    );
    expect(read).toBeDefined();

    const outcome = await read!.execute(
      { filePath: '/etc/hostname' } as never,
      {
        toolName: 'Read',
        parameters: {},
      } as never,
    );
    const result = JSON.parse(String((outcome as { data?: unknown }).data)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the working directory');
  });

  it('scopes robota’s file tools to the SHELL’s cwd, not some other directory', async () => {
    // Same tool, a path INSIDE the cwd the pack was built with → the guard does not fire (the failure is
    // a missing file, not an access denial). This is what proves the scope is the shell's cwd.
    const read = robotaRuntimeOptions().toolOptions.additionalTools.find(
      (t) => t.getName() === 'Read',
    );
    const outcome = await read!.execute(
      { filePath: `${SEAM_CWD}/absent.txt` } as never,
      {
        toolName: 'Read',
        parameters: {},
      } as never,
    );
    const result = JSON.parse(String((outcome as { data?: unknown }).data)) as {
      success: boolean;
      error?: string;
    };

    expect(result.error).not.toContain('outside the working directory');
    expect(result.error).toContain('File not found');
  });

  it('lets the kernel apply the default preset’s permission posture when the shell left it unset', () => {
    // `careful-reviewer` maps autonomy 'ask-first' → permissionMode 'default' in agent-preset.
    expect(robotaRuntimeOptions({ defaultPresetId: 'careful-reviewer' }).permissionMode).toBe(
      'default',
    );
  });

  it('never lets the kernel overwrite an explicit shell permission mode (--permission-mode wins)', () => {
    expect(
      robotaRuntimeOptions({
        defaultPresetId: 'careful-reviewer',
        permissionMode: 'bypassPermissions',
      }).permissionMode,
    ).toBe('bypassPermissions');
  });

  it('keeps ONE preset SSOT — the same external preset resolves identically on both paths (B2)', () => {
    // ARCH-007 B2 decided the shell would keep `agent-preset`'s MODULE-GLOBAL registry as the SSOT,
    // because the resolved preset is needed BEFORE the base command modules are built and because
    // in-session `/preset` read that same registry. ARCH-009 removed the global: BOTH surfaces now read
    // the instance registry the shell built, and the product adopts that very instance. The gate is
    // unchanged in what it protects — the two paths must not split — but there is now one registry to
    // split FROM rather than two that happen to agree.
    const external: IPreset = {
      id: 'arch-007-probe',
      title: 'probe',
      description: 'B2 split-SSOT gate',
      persona: 'probe persona',
      autonomy: 'ask-first',
    };
    const shellRegistry = createPresetRegistry([external]);

    // (a) visible to the registry the startup delta + `/preset` discovery read…
    expect(shellRegistry.getPreset('arch-007-probe')).toBeDefined();
    expect(shellRegistry.listPresets().map((p) => p.id)).toContain('arch-007-probe');

    // (b) …and to the assembled product, resolving to exactly the same options.
    const { product } = robotaProduct({ presets: [external] });
    expect(product.resolvePreset('arch-007-probe')).toEqual(
      shellRegistry.resolvePreset('arch-007-probe'),
    );
    expect(product.resolvePreset('arch-007-probe')).toMatchObject({
      persona: 'probe persona',
      permissionMode: 'default',
    });
  });

  it('preserves the shell’s already-narrowed command-module selection (preset delta survives)', () => {
    // The preset's enabled/disabled delta is applied by the shell over the merged superset; the kernel
    // must not clobber that selection with its own unfiltered `base ⊕ packs` list.
    const options = robotaRuntimeOptions();
    const names = options.commandModules.map((m) => m.name);

    expect(names).toContain('agent-command-shell');
    expect(names).toContain('agent-command-workflows');
  });
});
