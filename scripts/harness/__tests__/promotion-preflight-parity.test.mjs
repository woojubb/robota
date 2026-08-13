import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CI_WORKFLOW = path.join(WORKSPACE_ROOT, '.github/workflows/ci.yml');
const PROMOTE_SCRIPT = path.join(WORKSPACE_ROOT, 'scripts/harness/promote.mjs');
const ROOT_PACKAGE = path.join(WORKSPACE_ROOT, 'package.json');

/**
 * The job name `protect-main` requires. Not a guess — `scan-main-required-checks` pins the ruleset's
 * contexts, and this is the substantive one.
 */
const MAIN_ONLY_JOB = 'release-grade verification';

/**
 * The `pnpm harness:*` entry points inside ONE named job.
 *
 * Scoped to the job's own block rather than grepped over the whole file: `ci.yml` runs several
 * harness entry points across its jobs, so a file-wide match would answer a different question than
 * the one being asked and pass for the wrong reason. The harness parses workflows as text
 * throughout — no YAML dependency exists here — so this reads the block boundary instead of the
 * document, which is the narrowest honest version of that.
 *
 * Returns `null` when the job is absent, so a rename fails loudly instead of vacuously.
 */
export function harnessEntryPointsOfJob(workflowText, jobDisplayName) {
  const lines = workflowText.split('\n');
  const nameIndex = lines.findIndex((line) => line.trim() === `name: ${jobDisplayName}`);
  if (nameIndex === -1) return null;

  // A job's key sits at 2-space indent; its body is deeper. Walk to the next key at that depth.
  const entryPoints = [];
  for (let i = nameIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}\S/.test(line)) break;
    // Both shapes: `run: pnpm harness:x` inline, and a block scalar's own line.
    const match = /^\s*(?:-\s+)?(?:run:\s*)?(pnpm\s+harness:[\w:-]+)\s*$/.exec(line);
    if (match) entryPoints.push(match[1]);
  }
  return entryPoints;
}

/**
 * Protected CI is the only automatic release-verification result consumed by `protect-main`.
 * Promotion assembly keeps its deterministic tree and ancestry checks local, while the root release
 * command remains reachable for explicit diagnosis. These tests pin that ownership boundary so the
 * full release sweep cannot silently become an automatic local prerequisite again.
 */
describe('promotion verification has one automatic owner', () => {
  const workflowText = readFileSync(CI_WORKFLOW, 'utf8');
  const promoteSource = readFileSync(PROMOTE_SCRIPT, 'utf8');

  it('finds the main-only required job', () => {
    // Fail closed: a rename would make every assertion below pass over nothing.
    expect(harnessEntryPointsOfJob(workflowText, MAIN_ONLY_JOB)).not.toBeNull();
  });

  it('reads exactly one harness entry point from that job', () => {
    // More than one means "which command mirrors this gate" has several answers and the pin below
    // would silently check whichever came first.
    expect(harnessEntryPointsOfJob(workflowText, MAIN_ONLY_JOB)).toHaveLength(1);
  });

  it('leaves the required release entry point to protected CI instead of spawning a local duplicate', () => {
    expect(promoteSource).not.toMatch(/from\s+['"]node:child_process['"]/);
    expect(promoteSource).not.toMatch(/\b(?:spawn|spawnSync|exec|execFile)\s*[:=(]/);
    expect(promoteSource).not.toMatch(/\b(?:spawn|env)\s*=/);
    expect(
      JSON.parse(readFileSync(ROOT_PACKAGE, 'utf8')).scripts['harness:verify:release'],
    ).toBeTruthy();
  });

  it('has no local release-gate bypass mode', () => {
    expect(promoteSource).not.toContain('--skip-release-gate');
    expect(promoteSource).not.toContain('release gate PASSED locally');
  });

  it('compares promotion-local novelty against develop in the main-only release job', () => {
    const nameIndex = workflowText.indexOf(`name: ${MAIN_ONLY_JOB}`);
    const nextJobIndex = workflowText.indexOf('\n  # ', nameIndex + 1);
    const jobBlock = workflowText.slice(nameIndex, nextJobIndex === -1 ? undefined : nextJobIndex);

    expect(jobBlock).toMatch(/HARNESS_BASE_REF:\s*origin\/develop/);
    expect(jobBlock).toMatch(/PR_HEAD_SHA:/);
  });
});
