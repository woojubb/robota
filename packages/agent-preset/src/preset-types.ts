import type { ICreateSessionOptions } from '@robota-sdk/agent-framework';

/**
 * Effort dial passed through to the model invocation (mechanism, not persona text).
 * `'xhigh'` corresponds to the long-running ("ultra") tier; `'high'` is the neutral default.
 */
export type TPresetEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Behavioural autonomy posture. Drives the permission posture
 * (`permissionMode` / `defaultTrustLevel`) — it is a mechanism mapping, not a display label.
 */
export type TPresetAutonomy = 'ask-first' | 'balanced' | 'act-first';

/** Default trust level applied when the preset opts into a coarse permission posture. */
export type TPresetTrustLevel = 'safe' | 'moderate' | 'full';

/**
 * Permission mode reused from the framework option SSOT (`ICreateSessionOptions`).
 * Reusing the indexed access keeps a single source of truth for the permission-mode union.
 */
export type TPresetPermissionMode = ICreateSessionOptions['permissionMode'];

/**
 * The framework-facing option subset a preset resolves into. Every field maps to an
 * existing `agent-framework` session/assembly seam; presets never introduce new option types.
 */
export interface TResolvedPresetOptions {
  // (2) Persona
  /**
   * Portable persona/behaviour block (tone, refusal philosophy, output style, proactivity).
   * Composed by the framework as a `source: 'persona'` system-prompt section (priority 5) —
   * never runtime/tool/product-identity text. Empty/undefined adds no section (no regression).
   */
  persona?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  agentName?: string;

  // (3) Model / effort
  model?: string;
  language?: string;
  effort?: TPresetEffort;
  temperature?: number;
  maxOutputTokens?: number;

  // (4) Permission / trust profile
  permissionMode?: TPresetPermissionMode;
  defaultTrustLevel?: TPresetTrustLevel;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];

  // (5) Command module selection
  enabledCommandModules?: readonly string[];
  disabledCommandModules?: readonly string[];

  // (6) Execution capabilities (framework/executor seam flags, not persona text)
  enableParallelSubagents?: boolean;
  selfVerification?: boolean;

  // (7) Behaviour guide — autonomy drives the permission posture above
  autonomy?: TPresetAutonomy;
}

/**
 * A named, pre-tuned bundle of framework option overrides plus display identity.
 * Extends `TResolvedPresetOptions` (type SSOT) and adds the identity triple.
 */
export interface IPreset extends TResolvedPresetOptions {
  id: string;
  title: string;
  description: string;
}
