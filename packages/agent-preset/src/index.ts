/**
 * @robota-sdk/agent-preset — IPreset contract, the instance-scoped preset registry and its
 * precedence merger, and built-in preset definitions. Depends only on `@robota-sdk/agent-framework`
 * (option types).
 *
 * ARCH-009 removed the module-global registry (`registerExternalPresets`, `clearExternalPresets`,
 * and the process-wide `resolvePreset`/`listPresets`/`getPreset`). Every reader now comes from a
 * registry someone constructed and owns — `createPresetRegistry()` with no argument is the built-ins.
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
  createPresetRegistry,
  partitionExternalPresets,
} from './resolve-preset.js';

export type {
  IPresetSummary,
  IResolvePresetContext,
  IPresetRegistrationResult,
  IPresetRegistry,
} from './resolve-preset.js';

export {
  loadExternalPresets,
  loadExternalPresetsFromDir,
  defaultExternalPresetDir,
} from './load-external-presets.js';

export type { IExternalPresetLoadResult } from './load-external-presets.js';

export { validateExternalPreset } from './preset-validation.js';

export type { TPresetValidationResult } from './preset-validation.js';
