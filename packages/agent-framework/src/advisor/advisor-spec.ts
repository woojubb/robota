/** Which configured model advises: a provider profile, optionally with a model of that profile. */
export interface IAdvisorSpec {
  readonly profile: string;
  readonly model?: string;
}

export interface IAdvisorStatus {
  /** The target, as `profile` or `profile:model`; absent when none is set. */
  readonly target?: string;
  readonly enabled: boolean;
  /** Whether this session has the Advisor tool (decided at session start). */
  readonly registered: boolean;
  readonly killSwitch: boolean;
  readonly sessionCalls: number;
  readonly maxCallsPerSession: number;
}

export interface IAdvisorSetResult {
  readonly success: boolean;
  readonly message: string;
  /** The spec to save as the default, or `'off'`; absent when nothing changed. */
  readonly saved?: string;
}

/** What `/advisor` reads and changes on the live session. */
export interface ICommandAdvisorAdapter {
  status(): IAdvisorStatus;
  set(value: string): IAdvisorSetResult;
}

/** The word that turns the advisor off wherever a spec is accepted. */
export const ADVISOR_OFF = 'off';

/**
 * Read `profile` or `profile:model`. `off` reads as `'off'`; an empty value reads as `undefined`.
 * Only the first colon splits, because model ids may themselves contain colons.
 */
export function parseAdvisorSpec(value: string | undefined): IAdvisorSpec | 'off' | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) return undefined;
  if (trimmed === ADVISOR_OFF) return 'off';
  const colon = trimmed.indexOf(':');
  if (colon === -1) return { profile: trimmed };
  const profile = trimmed.slice(0, colon).trim();
  const model = trimmed.slice(colon + 1).trim();
  if (profile.length === 0) {
    throw new Error(`Invalid advisor "${trimmed}": expected <profile> or <profile>:<model>.`);
  }
  return model.length > 0 ? { profile, model } : { profile };
}

export function formatAdvisorSpec(spec: IAdvisorSpec): string {
  return spec.model === undefined ? spec.profile : `${spec.profile}:${spec.model}`;
}

/**
 * The advisor a session starts with: the flag when it was given, else the saved setting. A flag of
 * `off` wins over a saved advisor.
 */
export function resolveStartupAdvisorSpec(
  flag: string | undefined,
  setting: unknown,
): IAdvisorSpec | undefined {
  const fromFlag = parseAdvisorSpec(flag);
  if (fromFlag !== undefined) return fromFlag === 'off' ? undefined : fromFlag;
  const fromSetting = parseAdvisorSpec(typeof setting === 'string' ? setting : undefined);
  return fromSetting === 'off' ? undefined : fromSetting;
}
