/**
 * @robota-sdk/agent-preset — IPreset contract, the `resolvePreset` precedence merger,
 * and built-in preset definitions. Depends only on `@robota-sdk/agent-framework` (option types).
 */

export type {
  TPresetEffort,
  TPresetAutonomy,
  TPresetTrustLevel,
  TPresetPermissionMode,
  IResolvedPresetOptions,
  IPreset,
} from './preset-types.js';

export { defaultPreset } from './presets/default.js';

export { autonomousBuilderPreset } from './presets/autonomous-builder.js';

export {
  DEFAULT_AGENT_NAME,
  resolvePreset,
  listPresets,
  getPreset,
  registerExternalPresets,
  clearExternalPresets,
} from './resolve-preset.js';

export type {
  IPresetSummary,
  IResolvePresetContext,
  IPresetRegistrationResult,
} from './resolve-preset.js';

export {
  loadExternalPresets,
  loadExternalPresetsFromDir,
  defaultExternalPresetDir,
} from './load-external-presets.js';

export type { IExternalPresetLoadResult } from './load-external-presets.js';

export { validateExternalPreset } from './preset-validation.js';

export type { TPresetValidationResult } from './preset-validation.js';
