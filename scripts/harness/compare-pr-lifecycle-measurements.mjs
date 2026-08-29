#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.schema !== 1 || !Array.isArray(value.sourcePrs))
    throw new Error(`invalid measurement: ${file}`);
  return value;
}

export function compareMeasurements(baseline, candidate) {
  const checks = [
    ['baseline pr_lifecycle_count', baseline.prLifecycleCount, 2],
    ['candidate pr_lifecycle_count', candidate.prLifecycleCount, 1],
    ['candidate conversion_pr_count', candidate.conversionPrCount, 0],
    ['candidate conversion_pr_open_wait_seconds', candidate.conversionPrOpenWaitSeconds, 0],
  ];
  const failures = checks.filter(([, actual, expected]) => actual !== expected);
  if (failures.length > 0) {
    throw new Error(
      failures.map(([name, actual, expected]) => `${name}: ${actual} !== ${expected}`).join('; '),
    );
  }
  return { ok: true, baseline, candidate };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2)
    throw new Error('usage: compare-pr-lifecycle-measurements BASELINE CANDIDATE');
  compareMeasurements(read(argv[0]), read(argv[1]));
  process.stdout.write('comparison: pass\n');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error(`compare-pr-lifecycle-measurements: ${error.message}`);
    process.exitCode = 1;
  }
}
