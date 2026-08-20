import type { IPresetSurfaceOptions } from './preset-surface-options.js';

/** The session fields taken from the preset surface rather than from raw CLI flags. */
export interface IPresetSessionFields {
  appendSystemPrompt?: string;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
}

/**
 * The subset of the preset surface every shell forwards verbatim.
 *
 * One function because review found the failure it prevents: both `-p` and `--serve` took
 * `IPresetSurfaceOptions` and read `parseToolList(args.…)` anyway, so a preset's tool lists applied
 * in the TUI and were silently ignored in the other two — the half-applied divergence ARCH-040
 * Group C exists to close, reintroduced at two of three shells while the change that closed it was
 * in flight (issue #1934).
 *
 * The projection test could not catch that: it asserts the mode surfaces ACCEPT every field, which
 * is a compile-time property. Accepting a field and reading it are different claims, and only the
 * first was ever checked. This function is the second one made assertable.
 *
 * `appendSystemPrompt` rides here too because it reaches the session by the same route and for the
 * same reason (issue #1937) — the CLI-sourced text, composed once at the projection.
 */
export function presetSessionFields(preset: Partial<IPresetSurfaceOptions>): IPresetSessionFields {
  return {
    ...(preset.cliAppendSystemPrompt !== undefined
      ? { appendSystemPrompt: preset.cliAppendSystemPrompt }
      : {}),
    ...(preset.allowedTools !== undefined ? { allowedTools: preset.allowedTools } : {}),
    ...(preset.deniedTools !== undefined ? { deniedTools: preset.deniedTools } : {}),
  };
}
