import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { splitWorkflowJobs } from './scan-ci-base-history.mjs';
import { splitJobSteps } from './scan-main-required-checks.mjs';

export const CI_WORKFLOW = path.join('.github', 'workflows', 'ci.yml');
export const REQUIRED_CHECKS_DECLARATION = path.join('.github', 'required-status-checks.json');
export const MIRRORED_BRANCH = 'develop';

export function parseRequiredContexts(declarationJson, branch = MIRRORED_BRANCH) {
  const contexts = declarationJson?.branches?.[branch]?.required_status_checks;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    throw new Error(
      `${REQUIRED_CHECKS_DECLARATION} declares no required status checks for \`${branch}\`. An empty list would satisfy every mirror assertion vacuously — which is the defect this map exists to prevent.`,
    );
  }
  return contexts;
}

export function readRequiredContexts(root, branch = MIRRORED_BRANCH) {
  const declarationPath = path.join(root, REQUIRED_CHECKS_DECLARATION);
  if (!existsSync(declarationPath)) {
    throw new Error(
      `${REQUIRED_CHECKS_DECLARATION} not found — the mirror has no ruleset to pin to.`,
    );
  }
  return parseRequiredContexts(JSON.parse(readFileSync(declarationPath, 'utf8')), branch);
}

export function stepName(stepText) {
  const match = /^ {6}(?:- )?name:[ \t]*(.*)$|^ {8}name:[ \t]*(.*)$/m.exec(stepText);
  return match ? (match[1] ?? match[2] ?? '').trim() : undefined;
}

export function stepHasRun(stepText) {
  return /^ {8}run:/m.test(String(stepText ?? ''));
}

export function jobRunSteps(ciYaml, jobId) {
  const job = splitWorkflowJobs(ciYaml).find((entry) => entry.name === jobId);
  if (!job) {
    throw new Error(
      `ci.yml declares no job \`${jobId}\` — the mirror map names one that does not exist.`,
    );
  }
  return splitJobSteps(job.text).filter(stepHasRun).map(stepName).filter(Boolean);
}

export function readCiWorkflow(root) {
  const workflowPath = path.join(root, CI_WORKFLOW);
  if (!existsSync(workflowPath)) {
    throw new Error(
      `${CI_WORKFLOW} not found — the mirror cannot be pinned to a workflow it cannot read.`,
    );
  }
  return readFileSync(workflowPath, 'utf8');
}
