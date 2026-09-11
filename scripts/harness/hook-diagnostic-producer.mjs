/** Runtime observation for the checked-in hook diagnostic migration inventory. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { DIAGNOSTIC_REPORT_VERSION } from './diagnostic-core.mjs';
import {
  loadHookDiagnosticMigrationManifest,
  validateHookDiagnosticMigrationManifest,
} from './hook-diagnostic-inventory.mjs';
import { collectHookRegistrationFacts } from './hook-registration-facts.mjs';

const SUBJECT = {
  kind: 'hook-diagnostic-migration',
  value: '.agents/harness-diagnostic-migration.json',
};

function errorDetail(error) {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  const detail = String(error);
  return detail.trim().length > 0 ? detail : 'unknown migration inventory failure';
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requiredStatusContexts(root) {
  const declaration = JSON.parse(
    readFileSync(path.join(root, '.github/required-status-checks.json'), 'utf8'),
  );
  return Object.entries(declaration.branches).flatMap(([branch, value]) =>
    value.required_status_checks.map(({ context }) => ({ branch, context })),
  );
}

function unavailable(correlationId, detail) {
  return {
    version: DIAGNOSTIC_REPORT_VERSION,
    id: 'hook.diagnostic-migration-inventory',
    detectorId: 'hook.diagnostic-migration-inventory',
    correlationId,
    state: 'unavailable',
    subject: SUBJECT,
    examined: [SUBJECT],
    severity: 'error',
    evidence: [detail],
    recommendation: 'Restore the migration inventory inputs and run the harness scans again.',
    unavailable: { code: 'hook-migration-inventory-unavailable', detail },
  };
}

/**
 * Recompute the inventory observation for a scan run or receipt reuse.
 *
 * This returns a diagnostic result only. It deliberately has no process exit
 * policy and is therefore not registered as a SCAN_COMMANDS entry.
 */
export function collectHookDiagnosticInventoryResults({
  root,
  scanNames,
  correlationId,
  manifest: suppliedManifest,
}) {
  try {
    const manifest =
      suppliedManifest === undefined
        ? loadHookDiagnosticMigrationManifest(root)
        : validateHookDiagnosticMigrationManifest(suppliedManifest);
    const settings = JSON.parse(readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
    const evidence = [];
    const registeredScans = manifest.scanRegistrations.map((record) => record.subject.value);
    if (!sameJson(registeredScans, scanNames)) {
      evidence.push('scan registrations differ from the checked-in migration manifest');
    }

    const preToolRegistrations = collectHookRegistrationFacts(settings).filter(
      ({ event }) => event === 'PreToolUse',
    );
    if (
      !sameJson(
        manifest.preToolRegistrations.map((record) => record.registration),
        preToolRegistrations,
      )
    ) {
      evidence.push('PreToolUse registrations differ from the checked-in migration manifest');
    }

    for (const { vetoPath } of manifest.huskyVetoPaths) {
      if (!existsSync(path.join(root, '.husky', vetoPath.entrypoint))) {
        evidence.push(`Husky veto entrypoint is missing: .husky/${vetoPath.entrypoint}`);
      }
    }

    if (
      !sameJson(
        manifest.requiredStatusContexts.map((record) => record.statusContext),
        requiredStatusContexts(root),
      )
    ) {
      evidence.push('required status contexts differ from the checked-in migration manifest');
    }

    if (evidence.length === 0) {
      return [
        {
          version: DIAGNOSTIC_REPORT_VERSION,
          id: 'hook.diagnostic-migration-inventory',
          detectorId: 'hook.diagnostic-migration-inventory',
          correlationId,
          state: 'clean',
          subject: SUBJECT,
          examined: [SUBJECT],
          summary:
            'Hook diagnostic migration inventory matches scans, PreToolUse registrations, Husky entrypoints, and required status contexts.',
        },
      ];
    }
    return [
      {
        version: DIAGNOSTIC_REPORT_VERSION,
        id: 'hook.diagnostic-migration-inventory',
        detectorId: 'hook.diagnostic-migration-inventory',
        correlationId,
        state: 'finding',
        subject: SUBJECT,
        examined: [SUBJECT],
        severity: 'warning',
        evidence,
        recommendation:
          'Update the checked-in migration manifest before changing hook, Husky, scan, or required-context registration.',
      },
    ];
  } catch (error) {
    return [unavailable(correlationId, errorDetail(error))];
  }
}
