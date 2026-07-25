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
import {
  DEFAULT_AGENT_NAME,
  getPreset,
  listPresets,
  registerExternalPresets,
  resolvePreset,
} from '@robota-sdk/agent-preset';
import { assembleProduct } from '@robota-sdk/agent-product';
import { describe, expect, it } from 'vitest';

import {
  buildRobotaRuntimeOptions,
  selectProductCommandModules,
} from '../product/robota-plumbing.js';
import {
  createRobotaProfile,
  ROBOTA_PACK_COMMAND_MODULE_NAMES,
} from '../product/robota-profile.js';
import { buildCommandSetup } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IPreset } from '@robota-sdk/agent-preset';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

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
    presets: overrides.presets ?? [],
    defaultPresetId: overrides.defaultPresetId ?? 'default',
    baseCommandModules,
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
    expect(robotaRuntimeOptions().additionalTools.map((t) => t.getName())).toEqual([
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
    ]);
  });

  it('removing the coding pack removes its TOOLS and SUBAGENTS from robota’s runtime options', () => {
    const withoutPack = robotaRuntimeOptions({ packs: 'none' });

    expect(withoutPack.additionalTools).toEqual([]);
    expect(withoutPack.agentDefinitions).toEqual([]);
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
    // ARCH-007 B2, decided: the shell keeps `agent-preset`'s MODULE-GLOBAL registry as the SSOT, because
    // the resolved preset is needed BEFORE the base command modules are built (its module-selection delta
    // feeds them) and because the in-session `/preset` command reads that same registry. The kernel's
    // per-call instance registry (R8) is the EXTERNAL-consumer path; the two cannot split, because the
    // shell feeds the very presets it registered into the profile. This test is the anti-split gate.
    const external: IPreset = {
      id: 'arch-007-probe',
      title: 'probe',
      description: 'B2 split-SSOT gate',
      persona: 'probe persona',
      autonomy: 'ask-first',
    };
    registerExternalPresets([external]);

    // (a) visible to the module-global registry the startup delta + `/preset` read…
    expect(getPreset('arch-007-probe')).toBeDefined();
    expect(listPresets().map((p) => p.id)).toContain('arch-007-probe');

    // (b) …and to the kernel's instance registry, resolving to exactly the same options.
    const { product } = robotaProduct({ presets: [external] });
    expect(product.resolvePreset('arch-007-probe')).toEqual(resolvePreset('arch-007-probe'));
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
