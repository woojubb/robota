/**
 * @robota-sdk/agent-preset — IPreset contract, the `resolvePreset` precedence merger,
 * and built-in preset definitions. Depends only on `@robota-sdk/agent-framework` (option types).
 */

export type {
  TPresetEffort,
  TPresetAutonomy,
  TPresetTrustLevel,
  TPresetPermissionMode,
  TResolvedPresetOptions,
  IPreset,
} from './preset-types.js';

export { defaultPreset } from './presets/default.js';

export { autonomousBuilderPreset } from './presets/autonomous-builder.js';

export { DEFAULT_AGENT_NAME, resolvePreset, listPresets, getPreset } from './resolve-preset.js';

export type { IPresetSummary, IResolvePresetContext } from './resolve-preset.js';
