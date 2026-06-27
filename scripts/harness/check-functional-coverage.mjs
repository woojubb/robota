#!/usr/bin/env node

/**
 * TEST-003 functional-coverage check.
 *
 * Enforces the testing-layering rule mechanically: every framework capability the CLI exposes must
 * have a kit-based functional test that drives a REAL InteractiveSession through
 * @robota-sdk/agent-framework/testing — not a CLI-surface test, not a skipped E2E.
 *
 * The manifest (functional-coverage-manifest.json) lists each capability and its functional test.
 * This check fails when a listed test file is missing or does not reference the functional harness.
 * Adding a framework capability without a manifest row + harness test is the regression this guards.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST_PATH = path.join(import.meta.dirname, 'functional-coverage-manifest.json');

function fail(messages) {
  console.error('✗ functional-coverage');
  for (const message of messages) console.error(`  - ${message}`);
  console.error(
    '\nEvery framework capability needs a kit-based functional test (see .agents/rules/testing-layering.md).',
  );
  process.exit(1);
}

if (!existsSync(MANIFEST_PATH)) {
  fail([`manifest not found: ${path.relative(WORKSPACE_ROOT, MANIFEST_PATH)}`]);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (error) {
  fail([`manifest is not valid JSON: ${error.message}`]);
}

const markers = Array.isArray(manifest.markers) ? manifest.markers : [];
const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
if (markers.length === 0) fail(['manifest "markers" must list at least one harness marker']);
if (capabilities.length === 0) fail(['manifest "capabilities" is empty']);

const findings = [];
const seen = new Set();

for (const capability of capabilities) {
  const { id, test } = capability ?? {};
  if (!id || !test) {
    findings.push(`capability entry missing "id" or "test": ${JSON.stringify(capability)}`);
    continue;
  }
  if (seen.has(id)) findings.push(`duplicate capability id: ${id}`);
  seen.add(id);

  const abs = path.join(WORKSPACE_ROOT, test);
  if (!existsSync(abs)) {
    findings.push(`${id}: functional test not found: ${test}`);
    continue;
  }
  const source = readFileSync(abs, 'utf8');
  if (!markers.some((marker) => source.includes(marker))) {
    findings.push(
      `${id}: ${test} does not use the functional harness (expected one of: ${markers.join(', ')})`,
    );
  }
}

if (findings.length > 0) fail(findings);

console.log(
  `✓ functional-coverage (${capabilities.length} capabilit${capabilities.length === 1 ? 'y' : 'ies'})`,
);
