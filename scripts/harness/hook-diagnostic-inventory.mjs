/**
 * Checked-in inventory of current scan, hook, and required-status registrations.
 *
 * The manifest is deliberately data, not a scan registration: it describes the
 * registration surface without adding an exit-bearing command to SCAN_COMMANDS.
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

function validateCommonRecord(record, name, additionalKeys = []) {
  assertObject(record, name);
  assertExactKeys(record, ['subject', ...additionalKeys], name);
  validateSubject(record.subject, `${name}.subject`);
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
  assertObject(manifest, 'hook registration inventory');
  assertExactKeys(
    manifest,
    [
      'version',
      'scanRegistrations',
      'preToolRegistrations',
      'huskyVetoPaths',
      'requiredStatusContexts',
    ],
    'hook registration inventory',
  );
  if (manifest.version !== 2) {
    throw new TypeError('hook registration inventory.version must equal 2');
  }
  for (const key of [
    'scanRegistrations',
    'preToolRegistrations',
    'huskyVetoPaths',
    'requiredStatusContexts',
  ]) {
    if (!Array.isArray(manifest[key])) {
      throw new TypeError(`hook registration inventory.${key} must be an array`);
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

/** Read and validate the current registration inventory from a repository root. */
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
