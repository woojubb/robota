/**
 * CLI-2004 — screen-reader enablement resolver (agent-cli owned).
 *
 * Resolves ONE user-facing accessibility switch (default OFF, opt-in) and reports WHICH channel
 * turned it on, so the TUI can print a self-diagnostic first line that does not lie about why the
 * mode is active.
 *
 * Precedence (lowest → highest): `screenReader` in settings.json ← `ROBOTA_SCREEN_READER=1|0` /
 * `INK_SCREEN_READER=true` ← `--screen-reader` / `--no-screen-reader` (the flag wins).
 *
 * This is a DELIBERATE inversion of the only existing precedent in this package —
 * `resolveMemoryEnablement` is env-wins (`memory-enablement.ts`). Accessibility inverts it because a
 * per-invocation flag must be able to turn the mode on for one run on a machine whose environment
 * has it off; that is the SSH/remote case. The divergence is recorded in `docs/SPEC.md` beside the
 * memory paragraph so the two are never read as one rule.
 *
 * `INK_SCREEN_READER` is honoured as an equal env-tier input rather than shadowed: Ink 7 reads it
 * itself (`process.env['INK_SCREEN_READER'] === 'true'`), so a run that only sets it would otherwise
 * get Ink's own behaviour while the confirmation line claimed the mode was off. Ink matches the
 * literal `'true'`, not `1` — the `ROBOTA_*=1` convention is mapped explicitly, never inherited.
 */

// The channel vocabulary is owned by the presentation package that prints it — importing it here
// keeps one declaration for one concept (no cross-package duplicate of the same union).
import type { TScreenReaderChannel } from '@robota-sdk/agent-transport-tui';

/** The resolved enablement decision after applying settings ← env ← flag precedence. */
export interface IResolvedScreenReaderEnablement {
  enabled: boolean;
  channel: TScreenReaderChannel | undefined;
}

/** Inputs to the pure enablement resolver. */
export interface IScreenReaderEnablementInputs {
  /** Parsed `screenReader` boolean from settings.json. Absent ⇒ default OFF. */
  settings?: boolean | undefined;
  /** `--screen-reader` (true) / `--no-screen-reader` (false); `undefined` when neither is given. */
  flagEnabled?: boolean | undefined;
  /** Raw `ROBOTA_SCREEN_READER` value (`'1'` enables, `'0'` disables; anything else ignored). */
  env?: string | undefined;
  /** Raw `INK_SCREEN_READER` value. Only Ink's own literal `'true'` enables. */
  inkEnv?: string | undefined;
}

/** Ink's documented enabling literal — matched exactly, per `ink@7.1.1`'s own contract. */
const INK_SCREEN_READER_ON = 'true';

/**
 * Environment variables whose mere presence suggests a screen reader is running. Used ONLY to print
 * one advisory line — never to enable the mode (verdict (d): opt-in, no auto-detect). A false
 * positive costs one line of text; auto-enabling on a false positive would reshape a sighted user's
 * UI, and this project has no telemetry that would ever surface that.
 */
const READER_HINT_PREFIXES = ['NVDA', 'JAWS', 'VOICEOVER', 'ORCA_'] as const;

/**
 * Extract the `screenReader` boolean from a raw settings record (the untyped `readSettings` result).
 * Returns `undefined` when absent or not a boolean — the resolver then treats it as default OFF.
 * Unknown or malformed values are ignored, never a throw.
 */
export function readScreenReaderSetting(
  settings: Record<string, unknown> | undefined,
): boolean | undefined {
  const raw = settings?.['screenReader'];
  return typeof raw === 'boolean' ? raw : undefined;
}

/**
 * Pure enablement resolver: settings ← env ← flag (flag wins). Default OFF.
 * `ROBOTA_SCREEN_READER=0` keeps the mode off against a `true` setting but loses to an explicit
 * `--screen-reader`, which is the difference between "off for one command" and "edit a JSON file".
 */
export function resolveScreenReaderEnablement(
  inputs: IScreenReaderEnablementInputs,
): IResolvedScreenReaderEnablement {
  let enabled = inputs.settings ?? false;
  let channel: TScreenReaderChannel | undefined = enabled ? 'settings' : undefined;

  // Env tier: the Robota switch and Ink's own variable are equal inputs at this level.
  const env = inputs.env?.trim();
  if (env === '1' || inputs.inkEnv?.trim() === INK_SCREEN_READER_ON) {
    enabled = true;
    channel = 'env';
  }
  if (env === '0') {
    enabled = false;
    channel = undefined;
  }

  // Flag tier (wins): a per-invocation override for a machine whose env/settings say otherwise.
  if (inputs.flagEnabled === true) {
    enabled = true;
    channel = 'flag';
  } else if (inputs.flagEnabled === false) {
    enabled = false;
    channel = undefined;
  }

  return { enabled, channel };
}

/**
 * True when the environment looks like a screen reader is present. Drives the single advisory line
 * printed when the mode is OFF — the whole of this project's answer to the auto-detection conflict
 * between the surveyed references.
 */
export function detectScreenReaderHint(env: Readonly<Record<string, string | undefined>>): boolean {
  const ink = env['INK_SCREEN_READER'];
  if (ink !== undefined && ink.trim() !== INK_SCREEN_READER_ON) return true;
  return Object.keys(env).some((name) =>
    READER_HINT_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
  );
}

/** The screen-reader fields the TUI render options declare. */
export interface IScreenReaderRenderFields {
  screenReader: boolean;
  screenReaderChannel: TScreenReaderChannel | undefined;
  screenReaderHint: boolean;
}

/**
 * The whole screen-reader decision as ONE call for the composition root: resolve the switch from all
 * three channels, and decide whether the OFF case has earned its advisory line.
 */
export function resolveScreenReaderRenderFields(
  settings: Record<string, unknown> | undefined,
  flagEnabled: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): IScreenReaderRenderFields {
  const resolved = resolveScreenReaderEnablement({
    settings: readScreenReaderSetting(settings),
    flagEnabled,
    env: env['ROBOTA_SCREEN_READER'],
    inkEnv: env['INK_SCREEN_READER'],
  });
  return {
    screenReader: resolved.enabled,
    screenReaderChannel: resolved.channel,
    screenReaderHint: !resolved.enabled && detectScreenReaderHint(env),
  };
}
