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
 * worth extracting. `scan-option-reachability` covers the hop below this one — from these options
 * into `createSession` — so the two together span the chain.
 */
export interface IPresetSurfaceOptions {
  agentName: string;
  activePresetId: string;
  persona: string | undefined;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  enableParallelSubagents?: boolean;
  selfVerification?: boolean;
  effort?: ICreateSessionOptions['effort'];
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
  };
}
