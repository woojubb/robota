/**
 * #3282 §4a — the GUI Settings screen's typed read/write, wired into the WS transport the same way
 * `reportCurrentSessionUsage` wires usage reads.
 *
 * Every write goes through the SAME path its slash command uses (`session.executeCommand`), so
 * "the behavior matches the TUI" is structural, not a promise kept by hand — a refusal a command
 * would give (an unknown id, a guarded permission mode) is the same refusal reported here, and an
 * optional `remoteCommandPolicy` gates a Settings-screen write exactly as it would the command. The
 * one exception is language's restart: `/language`'s host action always restarts the process (the
 * language is baked into the system prompt at startup), and a Settings-screen change must not — a
 * restart would drop every connected window — so `applyPatch`'s `language` case suppresses just
 * that restart request for the duration of its one `executeCommand` call (see its own comment).
 */
import { createPresetRegistry } from '@robota-sdk/agent-preset';
import {
  buildPermissionModeSubcommands,
  RECOMMENDED_RESPONSE_LANGUAGES,
  readPermissionRuleLayers,
} from '@robota-sdk/agent-framework';

import type {
  ICommandHostAdapters,
  ISettingsDocumentStore,
  TSettingsSource,
} from '@robota-sdk/agent-framework';
import type {
  ISettingsChoice,
  ISettingsPermissionRule,
  ISettingsSnapshot,
  TSettingsPatch,
} from '@robota-sdk/agent-interface-session';
import type {
  IProtocolSession,
  ISettingsReporter,
  TSettingsUpdateOutcome,
} from '@robota-sdk/agent-transport';

export interface ICreateSettingsReporterOptions {
  readonly commandHostAdapters: ICommandHostAdapters;
  readonly settingsSources: readonly TSettingsSource[];
  readonly settingsStores: readonly ISettingsDocumentStore[];
}

/** The sandbox mode the ON/OFF switch applies: confined, without a prompt for each command. */
const SANDBOX_ENABLED_MODE = 'auto-allow';
const SANDBOX_DISABLED_MODE = 'off';
const SANDBOX_REGULAR_MODE = 'regular';
const SKIPS_ALL_CHECKS_MODE = 'bypassPermissions';

/**
 * The switch has only two positions (on = `auto-allow`, off = `off`), but a host reached via `/sandbox`
 * or a saved setting can also be sitting in the third real mode, `regular` — confined, but each command
 * still prompts. That state reads as "on" (it isn't `off`), so its description must say prompts still
 * appear; the flat "without a prompt for each one" sentence is only true of `auto-allow`.
 */
function sandboxDescription(mode: string | undefined): string {
  if (mode === SANDBOX_REGULAR_MODE) {
    return 'Confines shell commands to the workspace and temp directories; prompts still appear for each one, as usual.';
  }
  return 'Confines shell commands to the workspace and temp directories, without a prompt for each one.';
}

export function createSettingsReporter(options: ICreateSettingsReporterOptions): ISettingsReporter {
  return {
    getSettings: (session) => buildSnapshot(session, options),
    updateSettings: (session, patch) => applyPatch(session, patch, options),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `data.outputStyles` / `data.presets` as the two commands' `list` branches shape them. */
function asChoices(
  value: unknown,
  map: (entry: Record<string, unknown>) => ISettingsChoice,
): ISettingsChoice[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(map);
}

async function buildSnapshot(
  session: IProtocolSession,
  options: ICreateSettingsReporterOptions,
): Promise<ISettingsSnapshot> {
  const { commandHostAdapters, settingsSources, settingsStores } = options;
  const status = session.getStatusSnapshot();

  // Reads the SAME `list` branch `/output-style` and `/preset` render — never a bare
  // `executeCommand(name, '')`, which would open an interactive ask instead of listing.
  const [outputStyleResult, presetResult] = await Promise.all([
    session.executeCommand('output-style', 'list', 'remote'),
    session.executeCommand('preset', 'list', 'remote'),
  ]);

  const outputStyleData = isRecord(outputStyleResult?.data) ? outputStyleResult.data : {};
  const outputStyleChoices = asChoices(outputStyleData['outputStyles'], (entry) => ({
    id: asString(entry['id']),
    label: asString(entry['name']) || asString(entry['id']),
    description: asString(entry['description']),
  }));
  const activeOutputStyle = asString(outputStyleData['active']);

  const presetData = isRecord(presetResult?.data) ? presetResult.data : {};
  const presetChoices = asChoices(presetData['presets'], (entry) => ({
    id: asString(entry['id']),
    label: asString(entry['title']) || asString(entry['id']),
    description: asString(entry['description']),
  }));
  const activePreset = asString(presetData['active']);

  // Pure/no-side-effect resolution (agent-preset's own contract) — peeks at what applying a preset
  // WOULD set the permission mode to, so the client can ask for confirmation before it ever sends
  // the patch, the same way it confirms picking "Skip all checks" from the mode control directly.
  const presetRegistry = createPresetRegistry();
  const skipsAllChecksPresetIds = presetChoices
    .map((choice) => choice.id)
    .filter((id) => presetRegistry.resolvePreset(id).permissionMode === SKIPS_ALL_CHECKS_MODE);

  const settingsDocument = commandHostAdapters.settings?.read() ?? {};
  const language = asString(settingsDocument['language']);

  // `displayName` is the plain label `@robota-sdk/agent-framework`'s own `PERMISSION_MODE_LABELS`
  // (#3282 §2) sets for every mode — reused here rather than kept as a second table.
  const permissionModeChoices: ISettingsChoice[] = buildPermissionModeSubcommands().map((sub) => ({
    id: sub.name,
    label: sub.displayName ?? sub.name,
    description: sub.description ?? '',
  }));

  const sandboxStatus = commandHostAdapters.sandbox?.status();

  return {
    language: {
      current: language,
      recommended: RECOMMENDED_RESPONSE_LANGUAGES.map((entry) => ({
        id: entry.code,
        label: entry.description,
        description: entry.code,
      })),
      appliesNote: 'Takes effect the next time Robota starts — changing it here never restarts it.',
    },
    outputStyle: { current: activeOutputStyle, choices: outputStyleChoices },
    preset: { current: activePreset, choices: presetChoices, skipsAllChecksPresetIds },
    permissionMode: {
      current: status.permissionMode,
      choices: permissionModeChoices,
      skipsAllChecksMode: SKIPS_ALL_CHECKS_MODE,
    },
    permissionRules: buildPermissionRules(settingsSources, settingsStores),
    sandbox: {
      enabled: sandboxStatus !== undefined && sandboxStatus.mode !== SANDBOX_DISABLED_MODE,
      available: sandboxStatus !== undefined && sandboxStatus.unavailable === undefined,
      ...(sandboxStatus?.unavailable !== undefined
        ? { unavailableReason: sandboxStatus.unavailable }
        : {}),
      description: sandboxDescription(sandboxStatus?.mode),
    },
  };
}

function buildPermissionRules(
  sources: readonly TSettingsSource[],
  stores: readonly ISettingsDocumentStore[],
): ISettingsPermissionRule[] {
  const writableScopes = new Set<string>(stores.map((store) => store.scope));
  const rules: ISettingsPermissionRule[] = [];
  for (const layer of readPermissionRuleLayers(sources)) {
    for (const kind of ['allow', 'deny', 'ask'] as const) {
      for (const pattern of layer[kind]) {
        rules.push({
          id: `${layer.scope}:${kind}:${pattern}`,
          scope: layer.scope,
          source: layer.source,
          kind,
          pattern,
          removable: writableScopes.has(layer.scope),
        });
      }
    }
  }
  return rules;
}

function failure(
  code: 'not_available' | 'invalid' | 'refused' | 'update_failed',
  message: string,
): TSettingsUpdateOutcome {
  return { ok: false, code, message };
}

async function succeed(
  session: IProtocolSession,
  options: ICreateSettingsReporterOptions,
): Promise<TSettingsUpdateOutcome> {
  return { ok: true, settings: await buildSnapshot(session, options) };
}

async function applyPatch(
  session: IProtocolSession,
  patch: TSettingsPatch,
  options: ICreateSettingsReporterOptions,
): Promise<TSettingsUpdateOutcome> {
  const { commandHostAdapters } = options;
  switch (patch.field) {
    case 'language': {
      const settings = commandHostAdapters.settings;
      if (!settings) return failure('not_available', 'Language is not available on this host.');
      const realProcess = commandHostAdapters.process;
      if (!realProcess) {
        // No process adapter to suppress a restart through — `/language`'s host action would fail
        // outright here (it requires one), so fall back to the settings document directly. Every
        // served mode wires a process adapter, so this is a defensive fallback, not the live path.
        settings.write({ ...settings.read(), language: patch.language });
        return succeed(session, options);
      }
      // Routes through the SAME command path as every other field (unlike the rest of this
      // function's doc comment implied before this fix), so an optional `remoteCommandPolicy`
      // gates a Settings-screen language change identically to a typed `/language` — the one
      // thing still special-cased is the restart `/language`'s host action always requests
      // afterward (the language is baked into the system prompt at startup): a Settings-screen
      // change must never restart the shared process, since that would drop every connected
      // window. `requestRestart` is swapped for a no-op on the shared adapters object for the
      // duration of this one call and restored in `finally`. Safe: given a non-empty language
      // (always true here — the Settings screen never sends an empty patch), `/language` resolves
      // synchronously with no interactive ask and no real I/O between the swap and the restore, so
      // no concurrently-running command on this process can observe the stub.
      commandHostAdapters.process = { ...realProcess, requestRestart: () => {} };
      try {
        const result = await session.executeCommand('language', patch.language, 'remote');
        if (!result || !result.success) {
          return failure('invalid', result?.message ?? 'Could not change the language.');
        }
        return succeed(session, options);
      } finally {
        commandHostAdapters.process = realProcess;
      }
    }
    case 'outputStyle': {
      const result = await session.executeCommand('output-style', patch.styleId, 'remote');
      if (!result || !result.success) {
        return failure('invalid', result?.message ?? 'Could not switch the output style.');
      }
      return succeed(session, options);
    }
    case 'preset': {
      const result = await session.executeCommand('preset', patch.presetId, 'remote');
      if (!result || !result.success) {
        return failure('invalid', result?.message ?? 'Could not switch the preset.');
      }
      return succeed(session, options);
    }
    case 'permissionMode': {
      const result = await session.executeCommand('mode', patch.mode, 'remote');
      if (!result || !result.success) {
        return failure('refused', result?.message ?? 'Could not change the permission mode.');
      }
      return succeed(session, options);
    }
    case 'sandbox': {
      const mode = patch.enabled ? SANDBOX_ENABLED_MODE : SANDBOX_DISABLED_MODE;
      const result = await session.executeCommand('sandbox', mode, 'remote');
      if (!result || !result.success) {
        return failure('refused', result?.message ?? 'Could not change the sandbox.');
      }
      return succeed(session, options);
    }
    case 'removePermissionRule': {
      const removeRule = commandHostAdapters.permissionRules?.removeRule;
      if (!removeRule) {
        return failure('not_available', 'Permission rules cannot be edited on this host.');
      }
      const removed = removeRule({ scope: patch.scope, kind: patch.kind, pattern: patch.pattern });
      if (!removed) return failure('invalid', 'That rule was already gone.');
      return succeed(session, options);
    }
    /* c8 ignore next 3 -- exhaustiveness guard: a patch variant added without a case fails to compile. */
    default: {
      const exhaustive: never = patch;
      return failure('invalid', `Unknown settings field: ${(exhaustive as TSettingsPatch).field}`);
    }
  }
}
