import { selectAction } from '@robota-sdk/agent-core';
import { applyPresetToSession } from '@robota-sdk/agent-framework';
import { createPresetRegistry } from '@robota-sdk/agent-preset';

import type {
  ICommandHostAdapterAccess,
  ICommandHostPresetApplication,
  IPresetApplicationOptions,
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IPresetSummary } from '@robota-sdk/agent-preset';

/**
 * ARCH-009 — the registry `/preset` discovers through.
 *
 * The host supplies the instance it resolved with through the ADAPTER bag — the same path
 * `/permission-mode` and `/plugin` already take to their host capabilities. A host that supplies none
 * gets a fresh built-ins registry. That order is the point: while discovery read a module-global
 * registry directly, two products in one process shared one mutable list, so ARCH-008's per-instance
 * resolution was only half-true for an embedded host. A command runs with an `ICommandHostContext`
 * and nothing else, so the context is the only path from here to the instance the shell built.
 *
 * The fallback is deliberate rather than transitional, and it is no longer process state: a host that
 * never loads external presets has nothing to hand over, and `/preset` should still list the
 * built-ins. `createPresetRegistry()` with no argument is exactly that, constructed per call.
 */
/**
 * What `/preset` actually needs from a registry — three members, no assertion.
 *
 * Narrower than `agent-preset`'s `IPresetRegistry` on purpose. Review of ARCH-009 reported the first
 * version reaching that contract with three casts, one of which (`listPresets()`) widened optional
 * `title`/`description` into required ones and would have printed `id — undefined: undefined` for a
 * host that typechecked. The fix is not a better cast: it is asking for the shape the command uses,
 * so both the built-in registry and a host adapter satisfy it STRUCTURALLY and nothing is asserted.
 *
 * `getPreset` returns `unknown` because presence is the whole question here.
 */
interface IPresetDiscovery {
  listPresets(): readonly IPresetSummary[];
  getPreset(id: string): unknown;
  resolvePreset(id: string, context?: unknown): IPresetApplicationOptions;
}

function presetRegistry(context: ICommandHostAdapterAccess): IPresetDiscovery {
  return context.getCommandHostAdapters?.().presetRegistry ?? createPresetRegistry();
}

/** Default active preset id reported when the runtime has no recorded active preset. */
const DEFAULT_ACTIVE_PRESET_ID = 'default';

/** Read the active preset id from the session, defaulting when the optional seam is absent. */
function readActivePresetId(context: ICommandHostSessionAccess): string {
  return context.getSession().getActivePresetId();
}

/** Build the `/preset` listing: one line per preset, marking the active one with a `*` prefix. */
function formatPresetList(active: string, registry: IPresetDiscovery): string {
  const lines = registry.listPresets().map((preset) => {
    const marker = preset.id === active ? '* ' : '  ';
    return `${marker}${preset.id} — ${preset.title}: ${preset.description}`;
  });
  return ['Available presets:', ...lines].join('\n');
}

/** Build the rejection message for an unknown preset id, listing the valid ids. */
function formatUnknownPresetMessage(id: string, registry: IPresetDiscovery): string {
  const ids = registry
    .listPresets()
    .map((preset) => preset.id)
    .join(', ');
  return `Unknown preset: ${id}. Available: ${ids}`;
}

/** The `/preset` (or `/preset list`) listing result. */
function presetListResult(
  context: ICommandHostSessionAccess,
  registry: IPresetDiscovery,
): ICommandResult {
  const active = readActivePresetId(context);
  return {
    message: formatPresetList(active, registry),
    success: true,
    data: { presets: registry.listPresets(), active },
  };
}

/**
 * Ask the user to pick a preset (CMD-004 inline ask). Returns the chosen id, or `undefined` when no
 * interactive renderer is attached or the user cancelled — the caller then shows the preset list.
 */
async function resolvePresetViaAsk(
  context: ICommandHostUserInteraction,
  registry: IPresetDiscovery,
): Promise<string | undefined> {
  const ui = context.getUserInteraction();
  if (!ui) return undefined;
  const options = registry.listPresets().map((preset) => ({
    value: preset.id,
    label: preset.id,
    description: preset.description,
  }));
  const response = await ui.ask(selectAction('preset', 'Select a preset', options));
  return response.type === 'answer' ? response.values[0] : undefined;
}

export async function executePresetCommand(
  context: ICommandHostPresetApplication &
    ICommandHostSessionAccess &
    ICommandHostUserInteraction &
    ICommandHostAdapterAccess,
  args: string,
): Promise<ICommandResult> {
  // ARCH-009: resolved ONCE per invocation, so listing, lookup and resolution cannot disagree — a
  // host that swapped registries mid-command would otherwise report one set and apply another.
  const registry = presetRegistry(context);
  let id: string | undefined = args.trim().split(/\s+/)[0];

  if (id === 'list') {
    return presetListResult(context, registry);
  }

  if (id === undefined || id.length === 0) {
    id = await resolvePresetViaAsk(context, registry);
    if (id === undefined) {
      return presetListResult(context, registry);
    }
  }

  if (registry.getPreset(id) === undefined) {
    return {
      message: formatUnknownPresetMessage(id, registry),
      success: false,
    };
  }

  const resolved = registry.resolvePreset(id);
  const result = await applyPresetToSession(context, id, resolved);
  // INFRA-032: surface any preset command-module name that matched no live module as a non-fatal
  // notice — an in-session `/preset` switch is no longer silent about a short form / typo.
  const noticeLines = result.unknownCommandModules.map(
    ({ name, kind }) =>
      `Preset command-module "${name}" (${kind}) matched no module — expected the agent-command-* form; ignored.`,
  );
  return {
    message: [`Switched to preset: ${id}`, ...noticeLines].join('\n'),
    success: true,
    data: { preset: id, unknownCommandModules: result.unknownCommandModules },
  };
}
