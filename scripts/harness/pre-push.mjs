#!/usr/bin/env node

/** Stable public import and CLI boundary for the Git pre-push gate. */
import path from 'node:path';

import { runPostVerdictGuard } from './pre-push-local-checks.mjs';
import { createPrePushSteps } from './pre-push-runtime.mjs';
import { runPrePushGate } from './pre-push-work-run.mjs';

export {
  CI_BASE_REF_PLACEHOLDER,
  CI_HEAD_REF_PLACEHOLDER,
  CI_SCANS_JOB_MIRROR,
  createCiScansJobMirror,
} from './pre-push-ci-mirror.mjs';
export { prerequisitesFor, runPostVerdictGuard } from './pre-push-local-checks.mjs';
export {
  createPrePushRuntime,
  createPrePushSteps,
  resolvePrePushMode,
} from './pre-push-runtime.mjs';
export { createWorkRunMeasurementInput, runPrePushGate } from './pre-push-work-run.mjs';

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (!runPostVerdictGuard()) process.exit(2);
  runPrePushGate(createPrePushSteps());
}
