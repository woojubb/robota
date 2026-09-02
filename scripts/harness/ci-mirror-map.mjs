#!/usr/bin/env node

/**
 * Compatibility facade for what `pnpm harness:verify-like-ci` mirrors.
 *
 * Declarations live in responsibility-specific modules; existing consumers continue importing
 * every public name from this path.
 */
import { CI_STAGES } from './ci-mirror-stages.mjs';
import { CI_SETUP_STEPS } from './ci-mirror-setup-steps.mjs';

export { CI_STAGES } from './ci-mirror-stages.mjs';
export { NOT_MIRRORED, NOT_MIRRORED_BY_CONTEXT, RELEVANCE_KEYS } from './ci-mirror-exclusions.mjs';
export { CI_SETUP_STEPS } from './ci-mirror-setup-steps.mjs';
export {
  CI_WORKFLOW,
  jobRunSteps,
  MIRRORED_BRANCH,
  parseRequiredContexts,
  readCiWorkflow,
  readRequiredContexts,
  REQUIRED_CHECKS_DECLARATION,
  stepHasRun,
  stepName,
} from './ci-mirror-workflow.mjs';

/** Every `{ job, steps }` entry a stage declares. */
export function mirrorEntries(stage) {
  return stage?.mirrors ?? [];
}

/** The stages that claim at least one step of a given job. */
export function stagesMirroring(jobId) {
  return CI_STAGES.filter((stage) => mirrorEntries(stage).some((entry) => entry.job === jobId));
}

/** Every step name claimed by some stage for a given job. */
export function claimedSteps(jobId) {
  return new Set(
    CI_STAGES.flatMap((stage) =>
      mirrorEntries(stage)
        .filter((entry) => entry.job === jobId)
        .flatMap((entry) => entry.steps),
    ),
  );
}

/** A one-line statement of what a stage reproduces. */
export function describeCiSource(stage) {
  if (stage.extra) return `${stage.extra} — mirrors no CI job; kept because ${stage.why}`;
  return mirrorEntries(stage)
    .map((entry) => `ci.yml → ${entry.job} → ${entry.steps.join(' + ')}`)
    .join('; ');
}

/** Every step name declared CI plumbing for a given job. */
export function plumbingSteps(jobId) {
  return new Set((CI_SETUP_STEPS[jobId] ?? []).map((entry) => entry.step));
}
