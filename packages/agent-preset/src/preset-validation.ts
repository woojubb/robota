import type {
  IPreset,
  TPresetAutonomy,
  TPresetEffort,
  TPresetPermissionMode,
  TPresetTrustLevel,
  IResolvedPresetOptions,
} from './preset-types.js';

/** Result of {@link validateExternalPreset}: the validated preset, or a single error message. */
export type TPresetValidationResult = { ok: true; preset: IPreset } | { ok: false; error: string };

/** Runtime membership list for {@link TPresetEffort}. */
const EFFORT_VALUES: readonly TPresetEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Runtime membership list for {@link TPresetAutonomy}. */
const AUTONOMY_VALUES: readonly TPresetAutonomy[] = ['ask-first', 'act-first', 'balanced'];

/** Runtime membership list for {@link TPresetPermissionMode}. */
const PERMISSION_MODE_VALUES: readonly TPresetPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
];

/** Runtime membership list for {@link TPresetTrustLevel}. */
const TRUST_LEVEL_VALUES: readonly TPresetTrustLevel[] = ['safe', 'moderate', 'full'];

/** Narrowing guard: `value` is a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrowing guard: `value` is an array whose every element is a string. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Validate the string-typed optional fields onto `options`; return the first error, if any. */
function validateStringFields(
  value: Record<string, unknown>,
  options: IResolvedPresetOptions,
): string | undefined {
  const fields: readonly [string, unknown, (v: string) => void][] = [
    ['persona', value.persona, (v) => (options.persona = v)],
    ['systemPrompt', value.systemPrompt, (v) => (options.systemPrompt = v)],
    ['appendSystemPrompt', value.appendSystemPrompt, (v) => (options.appendSystemPrompt = v)],
    ['agentName', value.agentName, (v) => (options.agentName = v)],
    ['model', value.model, (v) => (options.model = v)],
    ['language', value.language, (v) => (options.language = v)],
  ];
  for (const [field, raw, assign] of fields) {
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'string') {
      return `${field}: expected a string`;
    }
    assign(raw);
  }
  return undefined;
}

/** Validate the number- and boolean-typed optional fields onto `options`; return the first error. */
function validateScalarFields(
  value: Record<string, unknown>,
  options: IResolvedPresetOptions,
): string | undefined {
  const numbers: readonly [string, unknown, (v: number) => void][] = [
    ['temperature', value.temperature, (v) => (options.temperature = v)],
    ['maxOutputTokens', value.maxOutputTokens, (v) => (options.maxOutputTokens = v)],
  ];
  for (const [field, raw, assign] of numbers) {
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
      return `${field}: expected a number`;
    }
    assign(raw);
  }

  const booleans: readonly [string, unknown, (v: boolean) => void][] = [
    [
      'enableParallelSubagents',
      value.enableParallelSubagents,
      (v) => (options.enableParallelSubagents = v),
    ],
    ['selfVerification', value.selfVerification, (v) => (options.selfVerification = v)],
  ];
  for (const [field, raw, assign] of booleans) {
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'boolean') {
      return `${field}: expected a boolean`;
    }
    assign(raw);
  }
  return undefined;
}

/** Validate the enum-typed optional fields onto `options`; return the first error, if any. */
function validateEnumFields(
  value: Record<string, unknown>,
  options: IResolvedPresetOptions,
): string | undefined {
  if (value.effort !== undefined) {
    if (!EFFORT_VALUES.includes(value.effort as TPresetEffort)) {
      return `effort: expected one of ${EFFORT_VALUES.join(', ')}`;
    }
    options.effort = value.effort as TPresetEffort;
  }

  if (value.autonomy !== undefined) {
    if (!AUTONOMY_VALUES.includes(value.autonomy as TPresetAutonomy)) {
      return `autonomy: expected one of ${AUTONOMY_VALUES.join(', ')}`;
    }
    options.autonomy = value.autonomy as TPresetAutonomy;
  }

  const modes: readonly [string, unknown, (v: TPresetPermissionMode) => void][] = [
    ['permissionMode', value.permissionMode, (v) => (options.permissionMode = v)],
    [
      'defaultPermissionMode',
      value.defaultPermissionMode,
      (v) => (options.defaultPermissionMode = v),
    ],
  ];
  for (const [field, raw, assign] of modes) {
    if (raw === undefined) {
      continue;
    }
    if (!PERMISSION_MODE_VALUES.includes(raw as TPresetPermissionMode)) {
      return `${field}: expected one of ${PERMISSION_MODE_VALUES.join(', ')}`;
    }
    assign(raw as TPresetPermissionMode);
  }

  if (value.defaultTrustLevel !== undefined) {
    if (!TRUST_LEVEL_VALUES.includes(value.defaultTrustLevel as TPresetTrustLevel)) {
      return `defaultTrustLevel: expected one of ${TRUST_LEVEL_VALUES.join(', ')}`;
    }
    options.defaultTrustLevel = value.defaultTrustLevel as TPresetTrustLevel;
  }
  return undefined;
}

/** Validate the string-array optional fields onto `options`; return the first error, if any. */
function validateArrayFields(
  value: Record<string, unknown>,
  options: IResolvedPresetOptions,
): string | undefined {
  const arrays: readonly [string, unknown, (v: readonly string[]) => void][] = [
    ['allowedTools', value.allowedTools, (v) => (options.allowedTools = v)],
    ['deniedTools', value.deniedTools, (v) => (options.deniedTools = v)],
    [
      'enabledCommandModules',
      value.enabledCommandModules,
      (v) => (options.enabledCommandModules = v),
    ],
    [
      'disabledCommandModules',
      value.disabledCommandModules,
      (v) => (options.disabledCommandModules = v),
    ],
  ];
  for (const [field, raw, assign] of arrays) {
    if (raw === undefined) {
      continue;
    }
    if (!isStringArray(raw)) {
      return `${field}: expected an array of strings`;
    }
    assign(raw);
  }
  return undefined;
}

/**
 * Manually validate an unknown value as an {@link IPreset} (no schema library).
 *
 * Required fields: non-empty `id`, `title`, `description` strings. Every other field is
 * optional and is validated only when present; an unrecognised field is dropped (the built
 * preset carries the recognised fields only, never unknown keys). On the first failed check
 * returns `{ ok: false, error: '<field>: <reason>' }`.
 */
export function validateExternalPreset(value: unknown): TPresetValidationResult {
  if (!isPlainObject(value)) {
    return { ok: false, error: 'preset: expected a non-null object' };
  }

  const requiredStrings: readonly ['id' | 'title' | 'description', unknown][] = [
    ['id', value.id],
    ['title', value.title],
    ['description', value.description],
  ];
  for (const [field, raw] of requiredStrings) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { ok: false, error: `${field}: expected a non-empty string` };
    }
  }

  // Accumulate recognised optional fields here, then spread onto the identity triple so the
  // built preset never carries unknown keys.
  const options: IResolvedPresetOptions = {};
  const error =
    validateStringFields(value, options) ??
    validateScalarFields(value, options) ??
    validateEnumFields(value, options) ??
    validateArrayFields(value, options);
  if (error !== undefined) {
    return { ok: false, error };
  }

  const preset: IPreset = {
    id: value.id as string,
    title: value.title as string,
    description: value.description as string,
    ...options,
  };
  return { ok: true, preset };
}
