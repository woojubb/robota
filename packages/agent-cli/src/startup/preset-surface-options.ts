import { DEFAULT_AGENT_NAME } from '@robota-sdk/agent-preset';

import type { ICreateSessionOptions } from '@robota-sdk/agent-framework';
import type { IResolvedPresetOptions } from '@robota-sdk/agent-preset';

/**
 * The preset fields every shell surface forwards, projected once.
 *
 * ARCH-013: this literal was written out three times inside `cli.ts` alone — once for print mode,
 * once for serve mode, once for the interactive renderer — and the three were kept in step by
 * memory. That is the item's cause in miniature: a field added to the resolved preset arrives at
 * whichever surfaces someone remembered, and is silently absent from the rest. `effort` was the
 * measured instance — three of the four built-in presets set it, and at startup it reached none of
 * the three surfaces while `/preset` applied it mid-session.
 *
 * Adding a field here now reaches every surface at once, which is the only property that makes this
 * worth extracting — and ARCH-041 made that true. Until then `print-mode.ts` and `serve-mode.ts` each
 * re-declared their own copy, the three had already drifted on `model`, and the projection scan's
 * configured surfaces saw two of the three. The mode surfaces take `Partial<IPresetSurfaceOptions>`
 * now, so there is one declaration and nothing to keep in step. `scan-option-reachability` covers the hop below this one — from these options
 * into `createSession` — so the two together span the chain.
 */
export interface IPresetSurfaceOptions {
  /**
   * CLI-076 / ARCH-040: the resolved model id — the same value the CLI header displays. Forwarded so
   * an explicit `--model` reaches the provider chat call rather than being silently replaced by the
   * session's default.
   *
   * ARCH-041 moved it HERE from `IPrintModePresetOptions`, where it was the measured drift: it
   * reached print mode and neither of the other two surfaces.
   *
   * Projected from `resolved.model`, and the shell's `?? providerSettings.model` fallback is left
   * where it is. The two cannot disagree: the shell computes `resolvedPreset.model ??
   * providerSettings.model`, so whenever this key is present it holds the same value, and whenever
   * it is absent the shell's own key is the one that survives the spread. Threading the fallback in
   * here as well would be a second answer to a question that already has one.
   */
  model?: string;
  agentName: string;
  activePresetId: string;
  persona: string | undefined;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  enableParallelSubagents?: boolean;
  selfVerification?: boolean;
  effort?: ICreateSessionOptions['effort'];
  /**
   * ARCH-040: the model group's other two dials. The live `/preset` path has always applied both
   * through `applyModelOptions`; startup applied neither, so one session held two answers for the
   * same preset depending on when it was chosen — what `effort` did before ARCH-013 stage 1.
   */
  temperature?: number;
  maxOutputTokens?: number;
  /** ARCH-040: response language, composed as a prompt section rather than a provider parameter. */
  language?: string;
  /**
   * ARCH-040: a preset-supplied system prompt that SEEDS the composed prompt.
   *
   * Named `presetSystemPrompt` on the SESSION, deliberately: the session's own `systemPrompt` option
   * REPLACES the composed prompt, and a preset pointing at that would drop the AGENTS.md and
   * capability sections without saying so. Two names because they are two different things.
   */
  systemPrompt?: string;
}

/**
 * @param resolved   The resolved preset — the merge of preset file, CLI overrides and defaults.
 * @param presetId   The selected preset's id, which is not a field of the resolved options.
 * @param permissionMode The posture the KERNEL resolved (explicit `--permission-mode`, else the
 *   preset's). ARCH-007: it comes back out of the kernel overlay rather than being re-derived here.
 */
export function buildPresetSurfaceOptions(
  resolved: IResolvedPresetOptions,
  presetId: string,
  permissionMode: ICreateSessionOptions['permissionMode'] | undefined,
): IPresetSurfaceOptions {
  return {
    ...(resolved.model !== undefined ? { model: resolved.model } : {}),
    agentName: resolved.agentName ?? DEFAULT_AGENT_NAME,
    activePresetId: presetId,
    persona: resolved.persona,
    ...(permissionMode !== undefined ? { permissionMode } : {}),
    ...(resolved.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: resolved.enableParallelSubagents }
      : {}),
    ...(resolved.selfVerification !== undefined
      ? { selfVerification: resolved.selfVerification }
      : {}),
    ...(resolved.effort !== undefined ? { effort: resolved.effort } : {}),
    ...(resolved.temperature !== undefined ? { temperature: resolved.temperature } : {}),
    ...(resolved.maxOutputTokens !== undefined
      ? { maxOutputTokens: resolved.maxOutputTokens }
      : {}),
    ...(resolved.language !== undefined ? { language: resolved.language } : {}),
    ...(resolved.systemPrompt !== undefined ? { systemPrompt: resolved.systemPrompt } : {}),
  };
}

/**
 * The projection as SESSION OPTIONS — one member renamed on the way.
 *
 * ARCH-040: the surface declares `systemPrompt`, because that is what the field is called on
 * `IResolvedPresetOptions` and the projection scan matches by name. The SESSION has two options one
 * letter apart: `systemPrompt` REPLACES the composed prompt, and `presetSystemPrompt` SEEDS it. A
 * bare `...presetSurface` therefore lands a preset's prompt on the replacing one and silently drops
 * the AGENTS.md and capability sections — the opposite of the decision, and invisible.
 *
 * Renamed here rather than at each shell, so the shells cannot disagree about which option a preset
 * means. That is the same reason `buildPresetSurfaceOptions` exists at all.
 */
export function toSessionOptions(
  surface: IPresetSurfaceOptions,
): Omit<IPresetSurfaceOptions, 'systemPrompt'> & { presetSystemPrompt?: string } {
  const { systemPrompt, ...rest } = surface;
  return {
    ...rest,
    ...(systemPrompt !== undefined ? { presetSystemPrompt: systemPrompt } : {}),
  };
}
