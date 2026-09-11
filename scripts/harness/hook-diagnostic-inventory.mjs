/**
 * Checked-in inventory for the hook and Husky diagnostic migration.
 *
 * The manifest is deliberately data, not a scan registration: it describes the
 * migration surface without adding an exit-bearing command to SCAN_COMMANDS.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const HOOK_DIAGNOSTIC_MIGRATION_MANIFEST = path.join(
  '.agents',
  'harness-diagnostic-migration.json',
);

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+(?:-[a-z0-9]+)*)*$/;

function assertObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function assertExactKeys(value, keys, name) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name} contains unsupported field ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${name} is missing required field ${key}`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertStableId(value, name) {
  assertNonEmptyString(value, name);
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a stable lowercase dot-or-dash identifier`);
  }
}

function validateSubject(subject, name) {
  assertObject(subject, name);
  assertExactKeys(subject, ['kind', 'value'], name);
  assertNonEmptyString(subject.kind, `${name}.kind`);
  assertNonEmptyString(subject.value, `${name}.value`);
}

function validateDisposition(disposition, name) {
  assertObject(disposition, name);
  assertNonEmptyString(disposition.kind, `${name}.kind`);
  if (disposition.kind === 'planned-diagnostic-migration') {
    assertExactKeys(disposition, ['kind', 'slice'], name);
    assertNonEmptyString(disposition.slice, `${name}.slice`);
    return;
  }
  if (disposition.kind === 'retained') {
    assertExactKeys(
      disposition,
      [
        'kind',
        'irreversibleRisk',
        'redactionPolicy',
        'preDenialReportId',
        'independentVerification',
      ],
      name,
    );
    assertNonEmptyString(disposition.irreversibleRisk, `${name}.irreversibleRisk`);
    assertNonEmptyString(disposition.redactionPolicy, `${name}.redactionPolicy`);
    assertStableId(disposition.preDenialReportId, `${name}.preDenialReportId`);
    assertNonEmptyString(disposition.independentVerification, `${name}.independentVerification`);
    return;
  }
  throw new TypeError(`${name}.kind must be planned-diagnostic-migration or retained`);
}

function validateCommonRecord(record, name, additionalKeys = []) {
  assertObject(record, name);
  assertExactKeys(
    record,
    [
      'owner',
      'subject',
      'diagnosticId',
      'currentExitBehavior',
      'classification',
      'reportId',
      'rationale',
      'disposition',
      ...additionalKeys,
    ],
    name,
  );
  assertNonEmptyString(record.owner, `${name}.owner`);
  validateSubject(record.subject, `${name}.subject`);
  assertStableId(record.diagnosticId, `${name}.diagnosticId`);
  assertNonEmptyString(record.currentExitBehavior, `${name}.currentExitBehavior`);
  assertNonEmptyString(record.classification, `${name}.classification`);
  assertStableId(record.reportId, `${name}.reportId`);
  assertNonEmptyString(record.rationale, `${name}.rationale`);
  validateDisposition(record.disposition, `${name}.disposition`);
}

function validateRegistration(registration, name) {
  assertObject(registration, name);
  assertExactKeys(
    registration,
    ['event', 'matcher', 'commandPath', 'occurrence', 'sourceId'],
    name,
  );
  assertNonEmptyString(registration.event, `${name}.event`);
  assertNonEmptyString(registration.matcher, `${name}.matcher`);
  assertNonEmptyString(registration.commandPath, `${name}.commandPath`);
  if (!Number.isInteger(registration.occurrence) || registration.occurrence < 1) {
    throw new TypeError(`${name}.occurrence must be a positive integer`);
  }
  assertNonEmptyString(registration.sourceId, `${name}.sourceId`);
}

function validateVetoPath(vetoPath, name) {
  assertObject(vetoPath, name);
  assertExactKeys(vetoPath, ['entrypoint', 'pathId', 'predicate'], name);
  assertNonEmptyString(vetoPath.entrypoint, `${name}.entrypoint`);
  assertStableId(vetoPath.pathId, `${name}.pathId`);
  assertStableId(vetoPath.predicate, `${name}.predicate`);
}

function validateStatusContext(statusContext, name) {
  assertObject(statusContext, name);
  assertExactKeys(statusContext, ['branch', 'context'], name);
  assertNonEmptyString(statusContext.branch, `${name}.branch`);
  assertNonEmptyString(statusContext.context, `${name}.context`);
}

/** Validate the complete manifest before any adapter consumes its declarations. */
export function validateHookDiagnosticMigrationManifest(manifest) {
  assertObject(manifest, 'hook diagnostic migration manifest');
  assertExactKeys(
    manifest,
    [
      'version',
      'scanRegistrations',
      'preToolRegistrations',
      'huskyVetoPaths',
      'requiredStatusContexts',
    ],
    'hook diagnostic migration manifest',
  );
  if (manifest.version !== 1) {
    throw new TypeError('hook diagnostic migration manifest.version must equal 1');
  }
  for (const key of [
    'scanRegistrations',
    'preToolRegistrations',
    'huskyVetoPaths',
    'requiredStatusContexts',
  ]) {
    if (!Array.isArray(manifest[key])) {
      throw new TypeError(`hook diagnostic migration manifest.${key} must be an array`);
    }
  }
  manifest.scanRegistrations.forEach((record, index) =>
    validateCommonRecord(record, `scanRegistrations[${index}]`),
  );
  manifest.preToolRegistrations.forEach((record, index) => {
    validateCommonRecord(record, `preToolRegistrations[${index}]`, ['registration']);
    validateRegistration(record.registration, `preToolRegistrations[${index}].registration`);
  });
  manifest.huskyVetoPaths.forEach((record, index) => {
    validateCommonRecord(record, `huskyVetoPaths[${index}]`, ['vetoPath']);
    validateVetoPath(record.vetoPath, `huskyVetoPaths[${index}].vetoPath`);
  });
  manifest.requiredStatusContexts.forEach((record, index) => {
    validateCommonRecord(record, `requiredStatusContexts[${index}]`, ['statusContext']);
    validateStatusContext(record.statusContext, `requiredStatusContexts[${index}].statusContext`);
  });
  return manifest;
}

/** Read and validate the parent-owned migration declaration from a repository root. */
export function loadHookDiagnosticMigrationManifest(root) {
  const file = path.join(root, HOOK_DIAGNOSTIC_MIGRATION_MANIFEST);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load ${HOOK_DIAGNOSTIC_MIGRATION_MANIFEST}: ${detail}`);
  }
  return validateHookDiagnosticMigrationManifest(parsed);
}
