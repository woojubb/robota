/**
 * The doctor's closed repair allowlist (OBSERVABILITY-1991).
 *
 * Two entries, both existing idempotent writers, both gated on the state being re-read IMMEDIATELY
 * before the write (the report a user read a minute ago is not the state on disk now):
 * - the host's own user settings file (id `settings.user.<family>`) exists but holds nothing
 *   (`empty`); rewriting it as `{}` through `writeSettings` loses no content and changes neither
 *   onboarding (`isFirstRun` keys on a separate marker) nor provider setup (which keys on document
 *   content).
 * - `storage.user` — the host's user store root or its sessions directory is missing or not
 *   owner-only; `ensureOwnerOnlyDirectory` creates and tightens both.
 * Anything else — an unknown id, a state that is not the repairable one, an already-clean check —
 * is refused with no write.
 */
import { ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';
import { inspectSettingsLayers, writeSettings } from '@robota-sdk/agent-framework';

import {
  isRepairableSettingsLayer,
  settingsCheckId,
  userSettingsCheckId,
} from './doctor-settings-probe.js';
import { userStorageState } from './doctor-storage-probe.js';

import type { IDoctorDeps, IDoctorInputs } from './doctor-types.js';

export const STORAGE_REPAIR_ID = 'storage.user';

/** The closed allowlist for this composition: the host's user settings layer id and `storage.user`. */
export function doctorRepairAllowlist(inputs: IDoctorInputs): readonly string[] {
  const settings = userSettingsCheckId(inputs);
  return settings === undefined ? [STORAGE_REPAIR_ID] : [settings, STORAGE_REPAIR_ID];
}

export interface IDoctorRepairPlan {
  readonly id: string;
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

export function isDoctorRepairId(id: string, inputs: IDoctorInputs): boolean {
  return doctorRepairAllowlist(inputs).includes(id);
}

function planSettingsRepair(id: string, inputs: IDoctorInputs): TDoctorRepairPlanResult {
  const layer = inspectSettingsLayers(inputs.settingsSources).layers.find(
    (candidate) => settingsCheckId(candidate.source) === id,
  );
  if (layer === undefined || layer.source.kind !== 'host') {
    return { ok: false, reason: `${id}: no user settings layer in this composition` };
  }
  if (!isRepairableSettingsLayer(layer, inputs)) {
    return { ok: false, reason: `${id}: state is ${layer.state}; only an empty file is rewritten` };
  }
  return {
    ok: true,
    plan: {
      id,
      description: 'rewrite the empty user settings file as {}',
      path: layer.source.path,
    },
  };
}

function planStorageRepair(inputs: IDoctorInputs, deps: IDoctorDeps): TDoctorRepairPlanResult {
  const state = userStorageState(inputs, deps);
  const { root } = inputs.userStorage;
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
      description:
        'create the user store root and its sessions directory as owner-only directories',
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
  if (!isDoctorRepairId(id, inputs)) {
    return {
      ok: false,
      reason: `${id}: not a repairable check (allowlist: ${doctorRepairAllowlist(inputs).join(', ')})`,
    };
  }
  return id === STORAGE_REPAIR_ID
    ? planStorageRepair(inputs, deps)
    : planSettingsRepair(id, inputs);
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
  if (current.plan.id === STORAGE_REPAIR_ID) {
    const { root, sessions } = inputs.userStorage;
    ensureOwnerOnlyDirectory(sessions, { withinRoot: root });
  } else {
    writeSettings(current.plan.path, {});
  }
  return { applied: true, plan: current.plan };
}
