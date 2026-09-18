/**
 * The doctor's closed repair allowlist (OBSERVABILITY-1991).
 *
 * Two entries, both existing idempotent writers, both gated on the state being re-read IMMEDIATELY
 * before the write (the report a user read a minute ago is not the state on disk now):
 * - `settings.user.robota` — the user settings file exists but holds nothing (`empty`); rewriting it
 *   as `{}` through `writeSettings` loses no content and changes neither onboarding (`isFirstRun` keys
 *   on a separate marker) nor provider setup (which keys on document content).
 * - `storage.user` — `~/.robota` or `~/.robota/sessions` is missing or not owner-only;
 *   `ensureOwnerOnlyDirectory` creates and tightens both.
 * Anything else — an unknown id, a state that is not the repairable one, an already-clean check —
 * is refused with no write.
 */
import { join } from 'node:path';

import { ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';
import { inspectSettingsLayers, writeSettings } from '@robota-sdk/agent-framework';

import { isRepairableSettingsLayer, settingsCheckId } from './doctor-settings-probe.js';
import { userStoragePaths, userStorageState } from './doctor-storage-probe.js';

import type { IDoctorDeps, IDoctorInputs } from './doctor-types.js';

export const DOCTOR_REPAIR_ALLOWLIST = ['settings.user.robota', 'storage.user'] as const;
export type TDoctorRepairId = (typeof DOCTOR_REPAIR_ALLOWLIST)[number];

export interface IDoctorRepairPlan {
  readonly id: TDoctorRepairId;
  /** What the writer will do, for the confirmation prompt. */
  readonly description: string;
  readonly path: string;
}

export type TDoctorRepairPlanResult =
  | { readonly ok: true; readonly plan: IDoctorRepairPlan }
  | { readonly ok: false; readonly reason: string };

export type TDoctorRepairOutcome =
  | { readonly applied: true; readonly plan: IDoctorRepairPlan }
  | { readonly applied: false; readonly reason: string };

export function isDoctorRepairId(id: string): id is TDoctorRepairId {
  return (DOCTOR_REPAIR_ALLOWLIST as readonly string[]).includes(id);
}

function planSettingsRepair(inputs: IDoctorInputs): TDoctorRepairPlanResult {
  const layer = inspectSettingsLayers(inputs.settingsSources).layers.find(
    (candidate) => settingsCheckId(candidate.source) === 'settings.user.robota',
  );
  if (layer === undefined || layer.source.kind !== 'host') {
    return {
      ok: false,
      reason: 'settings.user.robota: no user settings layer in this composition',
    };
  }
  if (!isRepairableSettingsLayer(layer)) {
    return {
      ok: false,
      reason: `settings.user.robota: state is ${layer.state}; only an empty file is rewritten`,
    };
  }
  return {
    ok: true,
    plan: {
      id: 'settings.user.robota',
      description: 'rewrite the empty user settings file as {}',
      path: layer.source.path,
    },
  };
}

function planStorageRepair(inputs: IDoctorInputs, deps: IDoctorDeps): TDoctorRepairPlanResult {
  const state = userStorageState(inputs, deps);
  const { root } = userStoragePaths(inputs.userHome);
  if (state !== 'missing' && state !== 'too-open') {
    return {
      ok: false,
      reason: `storage.user: state is ${state}; only a missing or too-open directory is repaired`,
    };
  }
  return {
    ok: true,
    plan: {
      id: 'storage.user',
      description: 'create ~/.robota and ~/.robota/sessions as owner-only directories',
      path: root,
    },
  };
}

/** Re-read the state now and decide whether `id` is repairable in it. Never writes. */
export function planDoctorRepair(
  id: string,
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
): TDoctorRepairPlanResult {
  if (!isDoctorRepairId(id)) {
    return {
      ok: false,
      reason: `${id}: not a repairable check (allowlist: ${DOCTOR_REPAIR_ALLOWLIST.join(', ')})`,
    };
  }
  return id === 'settings.user.robota'
    ? planSettingsRepair(inputs)
    : planStorageRepair(inputs, deps);
}

/**
 * Plan, confirm, re-plan, write. `confirm` is the host's prompt (`--yes` supplies `() => true`); a
 * refusal or an absent prompt writes nothing. The plan is recomputed after confirmation so a state
 * that changed while the user was deciding is refused rather than overwritten.
 */
export async function applyDoctorRepair(
  id: string,
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
  confirm: (plan: IDoctorRepairPlan) => Promise<boolean>,
): Promise<TDoctorRepairOutcome> {
  const first = planDoctorRepair(id, inputs, deps);
  if (!first.ok) return { applied: false, reason: first.reason };
  if (!(await confirm(first.plan)))
    return { applied: false, reason: `${id}: repair not confirmed; nothing written` };
  const current = planDoctorRepair(id, inputs, deps);
  if (!current.ok)
    return { applied: false, reason: `${current.reason} (state changed before the write)` };
  if (current.plan.id === 'settings.user.robota') {
    writeSettings(current.plan.path, {});
  } else {
    const { root, sessions } = userStoragePaths(inputs.userHome);
    ensureOwnerOnlyDirectory(sessions, { withinRoot: root });
  }
  return { applied: true, plan: current.plan };
}

/** The user settings path a repair targets — exported for the host's composition tests. */
export function userSettingsPathOf(userHome: string): string {
  return join(userHome, '.robota', 'settings.json');
}
