/**
 * @robota-sdk/agent-preset — IPreset contract, the instance-scoped preset registry and its
 * precedence merger, and built-in preset definitions. Depends only on `@robota-sdk/agent-framework`
 * (option types).
 *
 * There is no module-global registry or process-wide `resolvePreset`/`listPresets`/`getPreset`.
 * Every reader comes from a registry someone constructed and owns —
 * `createPresetRegistry()` with no argument is the built-ins.
 */

export type {
  TPresetEffort,
  TPresetAutonomy,
  TPresetPermissionMode,
  IResolvedPresetOptions,
  IPreset,
} from './preset-types.js';

export type {
  IOutputStyle,
  IOutputStyleFile,
  IOutputStyleLoadResult,
  IOutputStyleRegistry,
  IOutputStyleSource,
  IOutputStyleSummary,
  TOutputStyleSource,
  TOutputStyleTokenCost,
} from './output-style-types.js';

export { defaultPreset } from './presets/default.js';

export { autonomousBuilderPreset } from './presets/autonomous-builder.js';

export { createPresetRegistry, partitionExternalPresets } from './resolve-preset.js';

export type {
  IPresetSummary,
  IResolvePresetContext,
  IPresetRegistrationResult,
  IPresetRegistry,
} from './resolve-preset.js';

export { loadExternalPresetsFromFiles } from './load-external-presets.js';

export type { IExternalPresetFile, IExternalPresetLoadResult } from './load-external-presets.js';

export { validateExternalPreset } from './preset-validation.js';

export type { TPresetValidationResult } from './preset-validation.js';

export {
  builtInOutputStyles,
  createOutputStyleRegistry,
  loadOutputStylesFromSources,
  parseOutputStyleFile,
} from './output-style-registry.js';
