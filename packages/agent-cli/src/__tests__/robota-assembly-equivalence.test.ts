/**
 * ARCH-005 S2 — the EQUIVALENCE bar for collapsing `cli.ts`'s hand-wired composition root into
 * `assembleProduct(createRobotaProfile(…))`.
 *
 * Every literal below was captured from the PRE-CHANGE assembly (commit `378c585e9`, ARCH-005 S1 on
 * develop) by running the old hand-wired path and dumping its resolved values. The assertions then re-derive
 * the same values through the NEW profile-driven assembly. A drift in the assembled runtime — a lost command
 * module, a changed provider surface, a different preset resolution, a missing subagent — fails here.
 *
 * The bar is the SET of assembled materials, as the spec states ("same provider, same command-module set,
 * same preset resolution, same transport registry"). Module ORDER shifts by design: the coding modules
 * (`/shell`, `/editor`) now arrive from `pack-coding` and so are appended after the base instead of sitting
 * mid-list.
 *
 * That order IS user-visible, and the delta is ACCEPTED, not absent: `CommandRegistry.getCommands()`
 * concatenates per source with no sort, and `SystemCommandExecutor.listCommands()` returns Map values in
 * insertion order — so `/shell` and `/editor` move to the END of `/help` output and of the slash-command
 * autocomplete popup. Content identical, position changed. Restoring the old position would mean teaching
 * the neutral merger about one product's preferred ordering, which is exactly what the composition-
 * neutrality guards forbid — so the ordering delta is recorded in the ARCH-005 evidence log instead.
 */
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { BUILT_IN_AGENTS } from '@robota-sdk/agent-framework';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';
import { DEFAULT_AGENT_NAME, createPresetRegistry } from '@robota-sdk/agent-preset';
import { assembleProduct } from '@robota-sdk/agent-product';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import { describe, expect, it } from 'vitest';

import {
  findUnknownPresetModuleNames,
  mergedCommandModuleNames,
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
import type { ICommandModule } from '@robota-sdk/agent-framework';
import type { IPreset } from '@robota-sdk/agent-preset';

/* ── PRE-CHANGE BASELINE (captured from the hand-wired root before the collapse) ──────────────────── */

/**
 * The full command-module set `startCli` assembled with no preset delta: defaults + `/workflows`.
 *
 * This is a SET equality, not a floor, so a module added on purpose is recorded here in the same
 * change that adds it — which is the point: the baseline exists to make an accidental gain or loss
 * visible, and an entry appearing without a reason in the diff is the thing it catches.
 * `agent-command-peers` was added by PEER-004 (issue #1863); `agent-command-handoff` by
 * HANDOFF-001 (issue #1864).
 */
const BASELINE_COMMAND_MODULE_NAMES = [
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
  'agent-command-peers',
  'agent-command-handoff',
  'agent-command-remote-control',
  'agent-command-provider',
  'agent-command-workflows',
];

const BASELINE_PROVIDER_DEFINITION_TYPES = [
  'anthropic',
  'openai',
  'gemini',
  'gemma',
  'qwen',
  'deepseek',
];

const BASELINE_DEFAULT_TOOL_NAMES = [
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

const BASELINE_SUBAGENT_NAMES = ['general-purpose', 'Explore', 'Plan'];

const BASELINE_DEFAULT_AGENT_NAME = 'robota-cli';

/** `resolvePreset('default')` is a documented no-op; `careful-reviewer` carries a real posture. */
const BASELINE_DEFAULT_PRESET_OPTIONS = {};
const BASELINE_CAREFUL_REVIEWER_POSTURE = {
  effort: 'high',
  autonomy: 'ask-first',
  enableParallelSubagents: false,
  selfVerification: true,
  permissionMode: 'default',
};

/* ── The NEW assembly, driven exactly as `startCli` drives it ─────────────────────────────────────── */

const EQUIVALENCE_CWD = '/tmp/equivalence';
/** The packs the shell builds — same factory, same cwd `startCli` would pass. */
const ROBOTA_PACKS = createRobotaPacks({ cwd: EQUIVALENCE_CWD });
const ROBOTA_PACK_COMMAND_MODULE_NAMES = packCommandModuleNames(ROBOTA_PACKS);

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

/** The shell inputs that vary between cases — everything else is `startCli`'s fixed wiring. */
interface IAssembleOverrides {
  /** CLI args, as `parseCliArgs` would produce them. */
  args?: IParsedCliArgs;
  /** External presets the shell loaded from `~/.robota/presets/*.json`. */
  externalPresets?: readonly IPreset[];
  /** `settings.preset`, when the user configured one. */
  settingsPreset?: string;
}

/** Re-derive the shell's assembly for a given preset delta, mirroring `startCli` step for step. */
function assembleRobota(
  presetDelta: {
    enabledCommandModules?: readonly string[];
    disabledCommandModules?: readonly string[];
  } = {},
  overrides: IAssembleOverrides = {},
): {
  commandModules: readonly ICommandModule[];
  unknownModuleNames: readonly { name: string; kind: string }[];
  moduleNameSuperset: readonly string[];
  product: ReturnType<typeof assembleProduct>;
  preset: ReturnType<typeof resolveShellPreset>;
} {
  const args = overrides.args ?? MINIMAL_ARGS;
  const { providerDefinitions, baseCommandModules, fixedCommandModules } = buildCommandSetup(
    '/tmp/equivalence',
    MINIMAL_ARGS,
    {},
    '0.0.0-test',
    ROBOTA_PACK_COMMAND_MODULE_NAMES,
  );

  // ARCH-008: the SHIPPED shell resolution — one per-call registry, one resolve, handed whole to the
  // profile. Re-deriving it here (a fresh `createPresetRegistry` + a hand-built context) is exactly the
  // S2 F4 hole that let a mutation pass 247 tests, so this calls `resolveShellPreset` instead.
  const preset = resolveShellPreset(
    overrides.externalPresets ?? [],
    args,
    overrides.settingsPreset,
  );

  const product = assembleProduct(
    createRobotaProfile({
      version: '0.0.0-test',
      agentName: DEFAULT_AGENT_NAME,
      providerDefinitions,
      provider: createScriptedProvider([{ text: 'ok' }]).provider,
      preset,
      baseCommandModules,
      packs: ROBOTA_PACKS,
      backgroundTaskRunners: [],
      subagentRunnerFactory: (() => {
        throw new Error('not used');
      }) as never,
      transports: { startAll: async () => {}, stopAll: async () => {} } as never,
    }),
  );

  // Call the SHIPPED helpers, never a re-implementation of them. An inline copy of
  // `selectCommandModules(...) + fixedCommandModules` here left the production path uncovered: deleting
  // `...fixedCommandModules` from `selectProductCommandModules` — which drops `/workflows` and every
  // caller-injected module from the real CLI — kept the whole agent-cli suite green.
  const moduleNameSuperset = mergedCommandModuleNames(
    baseCommandModules,
    ROBOTA_PACK_COMMAND_MODULE_NAMES,
  );
  return {
    commandModules: selectProductCommandModules(product, fixedCommandModules, presetDelta),
    unknownModuleNames: findUnknownPresetModuleNames(moduleNameSuperset, presetDelta),
    moduleNameSuperset,
    product,
    preset,
  };
}

describe('ARCH-005 S2 — the assembled robota runtime matches the pre-change baseline', () => {
  it('assembles exactly the same command-module SET (no module gained or lost)', () => {
    const { commandModules } = assembleRobota();

    expect([...commandModules.map((m) => m.name)].sort()).toEqual(
      [...BASELINE_COMMAND_MODULE_NAMES].sort(),
    );
  });

  it('derives the same module-NAME superset the kernel actually merges (no drift)', () => {
    // The shell reports INFRA-032 unknown names from `mergedCommandModuleNames` BEFORE assembling (so the
    // notice survives the init/--configure early-returns). That shortcut is only valid while the derived
    // names equal the real merged product's names — asserted here so the two cannot drift apart.
    const { moduleNameSuperset, product } = assembleRobota();

    expect(moduleNameSuperset).toEqual(product.commandModules.map((m) => m.name));
  });

  it('composes NO capability rejection — the pack and the base do not collide', () => {
    expect(assembleRobota().product.rejectedCapabilities).toEqual([]);
  });

  it('sources the coding modules from pack-coding, not from the base set', () => {
    const { product } = assembleRobota();
    const packNames = ROBOTA_PACK_COMMAND_MODULE_NAMES;

    expect(packNames).toEqual(['agent-command-shell', 'agent-command-editor']);
    // Present in the merged product…
    for (const name of packNames) {
      expect(product.commandModules.map((m) => m.name)).toContain(name);
    }
    // …and load-bearing: dropping the pack from the profile drops them from the product.
    const withoutPack = assembleProduct({
      id: 'robota',
      providerDefinitions: [],
      provider: createScriptedProvider([{ text: 'ok' }]).provider,
      baseCommandModules: buildCommandSetup(
        '/tmp/equivalence',
        MINIMAL_ARGS,
        {},
        '0.0.0-test',
        packNames,
      ).baseCommandModules,
    });
    for (const name of packNames) {
      expect(withoutPack.commandModules.map((m) => m.name)).not.toContain(name);
    }
  });

  it('keeps the preset module-selection delta working over the merged superset', () => {
    // A disable of a PACK-supplied module must still take effect — the delta filters base ⊕ packs.
    const { commandModules } = assembleRobota({
      disabledCommandModules: ['agent-command-editor'],
    });
    expect(commandModules.map((m) => m.name)).not.toContain('agent-command-editor');
    expect(commandModules.map((m) => m.name)).toContain('agent-command-shell');
    // `/workflows` is a FIXED module — the delta never filters it (unchanged pre-existing behavior).
    expect(commandModules.map((m) => m.name)).toContain('agent-command-workflows');
  });

  it('still reports an unmatched preset module name (INFRA-032 notice), and none when matched', () => {
    // "editor" is the short form; the built module name is agent-command-editor → unmatched.
    expect(assembleRobota({ disabledCommandModules: ['editor'] }).unknownModuleNames).toEqual([
      { name: 'editor', kind: 'disabled' },
    ]);
    expect(
      assembleRobota({ disabledCommandModules: ['agent-command-editor'] }).unknownModuleNames,
    ).toEqual([]);
    expect(assembleRobota().unknownModuleNames).toEqual([]);
  });

  it('offers the same provider surface', () => {
    expect(assembleRobota().product.providerDefinitions.map((d) => d.type)).toEqual(
      BASELINE_PROVIDER_DEFINITION_TYPES,
    );
    expect(createDefaultProviderDefinitions().map((d) => d.type)).toEqual(
      BASELINE_PROVIDER_DEFINITION_TYPES,
    );
  });

  it('constructs the provider in-kernel from resolved settings (owner Decision 1)', () => {
    const { providerDefinitions } = buildCommandSetup(
      '/tmp/equivalence',
      MINIMAL_ARGS,
      {},
      '0.0.0-test',
    );
    const product = assembleProduct(
      createRobotaProfile({
        version: '0.0.0-test',
        agentName: DEFAULT_AGENT_NAME,
        providerDefinitions,
        providerSettings: { name: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
        preset: resolveShellPreset([], MINIMAL_ARGS, undefined),
        baseCommandModules: [],
        packs: ROBOTA_PACKS,
        backgroundTaskRunners: [],
        subagentRunnerFactory: (() => {
          throw new Error('not used');
        }) as never,
        transports: { startAll: async () => {}, stopAll: async () => {} } as never,
      }),
    );

    // The same provider the pre-change `createProviderFromSettings(cwd, model, {providerDefinitions})`
    // would have produced for these settings — built by the kernel now, from the shell's resolved data.
    expect(product.provider).toBeDefined();
  });

  it('exposes the same subagent roster through the runtime seam (owner Decision 2)', () => {
    const { product } = assembleRobota();

    expect(product.subagents.map((a) => a.name)).toEqual(BASELINE_SUBAGENT_NAMES);
    expect(BUILT_IN_AGENTS.map((a) => a.name)).toEqual(BASELINE_SUBAGENT_NAMES);

    const options = product.buildRuntimeOptions({
      session: {
        cwd: '/tmp/equivalence',
        provider: createScriptedProvider([{ text: 'ok' }]).provider,
      },
    });
    expect(
      (options as { agentDefinitions?: readonly { name: string }[] }).agentDefinitions?.map(
        (a) => a.name,
      ),
    ).toEqual(BASELINE_SUBAGENT_NAMES);
  });

  it('leaves the tool set and identity defaults untouched', () => {
    // ARCH-010 — `createDefaultTools` now requires the root. This case reads tool NAMES only and never
    // executes a tool, so the root is inert; it is the same `/tmp/equivalence` the session cases above
    // use, rather than a real workspace the assertion has no business pointing at.
    expect(createDefaultTools({ cwd: '/tmp/equivalence' }).map((t) => t.getName())).toEqual(
      BASELINE_DEFAULT_TOOL_NAMES,
    );
    expect(DEFAULT_AGENT_NAME).toBe(BASELINE_DEFAULT_AGENT_NAME);
  });

  it('resolves presets identically (built-ins reachable through the instance registry)', () => {
    const { product } = assembleRobota();
    // ARCH-009: the comparison partner used to be agent-preset's module-global resolver. It is now a
    // registry constructed with no external presets, which is the same built-ins by construction —
    // and the registry a host that supplies none gets.
    const builtIns = createPresetRegistry();

    expect(builtIns.resolvePreset('default')).toEqual(BASELINE_DEFAULT_PRESET_OPTIONS);
    expect(product.resolvePreset('default')).toEqual(BASELINE_DEFAULT_PRESET_OPTIONS);

    const carefulReviewer = product.resolvePreset('careful-reviewer');
    expect(carefulReviewer).toMatchObject(BASELINE_CAREFUL_REVIEWER_POSTURE);
    expect(carefulReviewer).toEqual(builtIns.resolvePreset('careful-reviewer'));
  });
});

/* ── ARCH-008 — ONE preset resolution path ────────────────────────────────────────────────────────── */

/** An external preset with a posture no built-in has, so a resolution can be traced to its source. */
const ARCH_008_EXTERNAL: IPreset = {
  id: 'arch-008-external',
  title: 'ARCH-008 probe',
  description: 'external preset used to trace which registry a resolution came from',
  persona: 'arch-008 persona',
  autonomy: 'act-first',
};

describe('ARCH-008 — robota resolves presets through the kernel’s per-call registry', () => {
  it('assembles the product over the SAME registry instance the shell resolved with', () => {
    // Not "an equivalent registry" — the same object. Two equivalent registries are two resolution
    // paths that agree today and can diverge tomorrow; this is what makes it one path.
    const { product, preset } = assembleRobota();

    expect(product.presets).toBe(preset.registry);
  });

  it('gives product.defaultPreset the shell’s resolution, CLI override layers included', () => {
    const args = {
      ...MINIMAL_ARGS,
      model: 'flag-model',
      permissionMode: 'plan',
    } as unknown as IParsedCliArgs;
    const { product, preset } = assembleRobota({}, { args });

    expect(product.defaultPreset).toEqual(preset.options);
    // …and the overrides really are in there (a resolution that dropped `cliOverrides` would return {}).
    expect(product.defaultPreset).toMatchObject({ model: 'flag-model', permissionMode: 'plan' });
  });

  it('resolves the SELECTED preset id, not a hard-coded default', () => {
    const { product, preset } = assembleRobota(
      {},
      { args: { ...MINIMAL_ARGS, preset: 'careful-reviewer' } as unknown as IParsedCliArgs },
    );

    expect(preset.presetId).toBe('careful-reviewer');
    expect(product.defaultPresetId).toBe('careful-reviewer');
    expect(product.defaultPreset).toMatchObject(BASELINE_CAREFUL_REVIEWER_POSTURE);
  });

  it('reaches the shell’s external presets through the product resolver', () => {
    const { product, preset } = assembleRobota(
      {},
      {
        externalPresets: [ARCH_008_EXTERNAL],
        args: { ...MINIMAL_ARGS, preset: ARCH_008_EXTERNAL.id } as unknown as IParsedCliArgs,
      },
    );

    expect(preset.options.persona).toBe('arch-008 persona');
    expect(product.resolvePreset(ARCH_008_EXTERNAL.id)).toMatchObject({
      persona: 'arch-008 persona',
      // `act-first` maps to acceptEdits in agent-preset's posture derivation.
      permissionMode: 'acceptEdits',
    });
    expect(product.presets.listPresets().map((p) => p.id)).toContain(ARCH_008_EXTERNAL.id);
  });

  it('keeps two assembleProduct calls in one process from contaminating each other (R8)', () => {
    const withExternal = assembleRobota({}, { externalPresets: [ARCH_008_EXTERNAL] }).product;
    const withoutExternal = assembleRobota().product;

    expect(withExternal.presets.getPreset(ARCH_008_EXTERNAL.id)).toBeDefined();
    expect(withoutExternal.presets.getPreset(ARCH_008_EXTERNAL.id)).toBeUndefined();
    expect(() => withoutExternal.resolvePreset(ARCH_008_EXTERNAL.id)).toThrow(/Unknown preset/);
    // Order-independent: the second call does not inherit the first, in EITHER direction.
    expect(
      assembleRobota({}, { externalPresets: [ARCH_008_EXTERNAL] }).product.presets.getPreset(
        ARCH_008_EXTERNAL.id,
      ),
    ).toBeDefined();
    // …and a registry built afterwards still starts at the built-ins, so nothing accumulated anywhere
    // a later host would read. Before ARCH-009 this asked the module-global registry; there is none.
    expect(
      createPresetRegistry()
        .listPresets()
        .map((p) => p.id),
    ).not.toContain(ARCH_008_EXTERNAL.id);
  });

  it('resolves robota’s startup preset from the shell’s list, by VALUE not by id', () => {
    // ARCH-008 wrote this as "same id in the module-global registry and in the shell's list; a
    // resolution that read the global returns FROM-THE-GLOBAL". ARCH-009 deleted the global, so that
    // spelling could no longer fail on the condition it named — the defect class this repository
    // scans for, and it would have sat inside the change that removed the condition.
    //
    // What survives is the half that can still fail: the VALUE comes from the list the shell handed
    // over. Asserting the value rather than "something resolved" is what makes a wrong source visible;
    // an "unknown id throws" assertion would pass no matter which list answered.
    const id = 'arch-008-dual';
    const { product, preset } = assembleRobota(
      {},
      {
        externalPresets: [
          { id, title: 'shell copy', description: 'shell posture', persona: 'FROM-THE-SHELL' },
        ],
        args: { ...MINIMAL_ARGS, preset: id } as unknown as IParsedCliArgs,
      },
    );

    expect(preset.options.persona).toBe('FROM-THE-SHELL');
    expect(product.defaultPreset?.persona).toBe('FROM-THE-SHELL');
    // And a registry built with no externals does not know the id at all — the source is the list,
    // never an ambient one.
    expect(createPresetRegistry().getPreset(id)).toBeUndefined();
  });
});
