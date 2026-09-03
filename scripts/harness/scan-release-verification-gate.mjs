#!/usr/bin/env node

/**
 * DIST-002 — keeps the published-artifact verification gate WIRED and HONEST.
 *
 * The gate itself (`verify-macos-release-artifacts.sh`, run by release-desktop-app.yml) answers "can a
 * user open what we published". This scan protects the gate from the four ways it can be silently
 * turned back into decoration — each of which has a real precedent in this repo:
 *
 *   1. the script disappears or stops being executable          -> the step errors, or worse, no-ops
 *   2. no workflow job invokes it                               -> the file exists and nothing runs it
 *   3. it stops checking the PUBLISHED artifact                 -> verifying a locally rebuilt copy passes
 *                                                                  while the uploaded asset stays broken
 *   4. it is neutered with continue-on-error / `|| true`        -> `scans` exited 0 while printing SKIPPED
 *
 * (3) is the important one and the reason this scan exists at all. The gate is EXPECTED TO BE RED until
 * signing lands, and the cheapest way to make a red gate green is to point it at something that passes.
 * A locally built binary carries the same ad-hoc signature but never acquires com.apple.quarantine, so a
 * gate aimed at `dist/bin/` would go green without a single thing about the release having improved.
 *
 * (4) matters because this gate is red ON PURPOSE right now, which makes it a standing temptation.
 * Suppressing it must be a visible, reviewable edit — not a two-character one.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const GATE_SCRIPT = 'scripts/harness/verify-macos-release-artifacts.sh';
const WORKFLOW_DIR = '.github/workflows';

/** Verifying a macOS artifact needs macOS: containers share the host kernel and Apple's licence
 *  confines macOS virtualization to Apple hardware, so there is no Linux substitute. */
const REQUIRED_RUNNER = 'macos-latest';

/**
 * HARNESS-065: this scan had NO direct-execution guard and no `main()` — its whole body ran at
 * module scope and ended in `process.exit(1)`. Importing it, which the harness test suite does to
 * every script, ran the scan and could terminate the importing process. Measured by importing all
 * 126 scripts and watching what happened, not by reading them.
 */
export function findReleaseVerificationGateFindings() {
  const findings = [];

  function fail(detail) {
    findings.push(detail);
  }

  // ---------------------------------------------------------------------------------------------
  // 1. The gate script exists and is executable.
  // ---------------------------------------------------------------------------------------------
  const gateAbs = path.join(WORKSPACE_ROOT, GATE_SCRIPT);
  if (!existsSync(gateAbs)) {
    fail(
      `${GATE_SCRIPT} is missing — the published-artifact verification gate has no implementation.`,
    );
  } else if ((statSync(gateAbs).mode & 0o111) === 0) {
    fail(`${GATE_SCRIPT} is not executable.`);
  }

  // ---------------------------------------------------------------------------------------------
  // 2..4. Some release workflow runs it, on macOS, against the published artifact, unsuppressed.
  // ---------------------------------------------------------------------------------------------
  const workflowsAbs = path.join(WORKSPACE_ROOT, WORKFLOW_DIR);
  const releaseWorkflows = existsSync(workflowsAbs)
    ? readdirSync(workflowsAbs).filter((f) => /^release-.*\.ya?ml$/.test(f))
    : [];

  let invocationFound = false;

  for (const file of releaseWorkflows) {
    const rel = path.join(WORKFLOW_DIR, file);
    const text = readFileSync(path.join(workflowsAbs, file), 'utf8');
    if (!text.includes(GATE_SCRIPT)) continue;
    invocationFound = true;

    // Locate the job containing the invocation. Jobs are the top-level keys under `jobs:` at two-space
    // indent; the gate's job is the last one declared at or before the invocation line.
    const lines = text.split('\n');
    const invocationLine = lines.findIndex((l) => l.includes(GATE_SCRIPT));
    let jobName = null;
    let jobStart = 0;
    for (let i = 0; i < invocationLine; i += 1) {
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
      if (m) {
        jobName = m[1];
        jobStart = i;
      }
    }
    if (!jobName) {
      fail(`${rel}: ${GATE_SCRIPT} is invoked outside any job block.`);
      continue;
    }

    // The job body runs to the next top-level job key.
    let jobEnd = lines.length;
    for (let i = invocationLine + 1; i < lines.length; i += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
        jobEnd = i;
        break;
      }
    }
    // Comment lines are stripped before any check that asks "does this job DO x". Matching prose would
    // let a job satisfy the scan with a comment describing a command it does not run — and would equally
    // let a comment explaining why a local path is avoided trip the local-path clause. Only whole-line
    // YAML comments are removed, so a `#` inside a shell expansion (`${pattern#release/}`) survives.
    const jobBodyCode = lines
      .slice(jobStart, jobEnd)
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    const where = `${rel}: job "${jobName}"`;

    // 2b. macOS runner.
    if (!new RegExp(`runs-on:\\s*${REQUIRED_RUNNER}`).test(jobBodyCode)) {
      fail(
        `${where} runs the macOS verification gate but is not \`runs-on: ${REQUIRED_RUNNER}\`. ` +
          `codesign/spctl do not exist off macOS, so the gate could only report a skip.`,
      );
    }

    // 3. It must verify the PUBLISHED artifact, not a local build.
    if (!/gh release download/.test(jobBodyCode)) {
      fail(
        `${where} does not \`gh release download\` — the gate must verify the PUBLISHED asset. ` +
          `A locally built copy never carries com.apple.quarantine, so verifying one passes while the ` +
          `artifact users download stays broken.`,
      );
    }
    for (const localPath of ['dist/bin', 'apps/agent-app/release', 'packages/agent-cli/dist']) {
      if (jobBodyCode.includes(localPath)) {
        fail(
          `${where} references the local build path "${localPath}". The gate must read only what was ` +
            `published to the Release.`,
        );
      }
    }

    // 4. Not suppressed.
    if (/continue-on-error:\s*true/.test(jobBodyCode)) {
      fail(
        `${where} sets continue-on-error: true — the verification gate would not gate anything.`,
      );
    }
    const invocationText = lines[invocationLine];
    if (/\|\|\s*(true|:)\s*$/.test(invocationText) || /\|\|\s*echo/.test(invocationText)) {
      fail(`${where} swallows the gate's exit code (\`|| true\`-style) on the invocation line.`);
    }
  }

  if (!invocationFound) {
    fail(
      `No workflow under ${WORKFLOW_DIR}/release-*.yml invokes ${GATE_SCRIPT}. ` +
        `The gate exists but nothing runs it.`,
    );
  }

  // ---------------------------------------------------------------------------------------------

  return findings;
}

function main() {
  const findings = findReleaseVerificationGateFindings();
  if (findings.length > 0) {
    console.error('release-verification-gate scan: FINDINGS');
    for (const f of findings) console.error(`  - ${f}`);
    console.error(
      '\nSee .agents/tasks/DIST-002-release-artifact-verification.md. This gate is red on purpose ' +
        'until signing lands; suppressing it is not the fix.',
    );
    // `exitCode`, not `exit()`: the 60 scripts that already moved do it this way, and an exported
    // module that can terminate its importer is not testable.
    process.exitCode = 1;
    return;
  }

  console.log('release-verification-gate scan: clean');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
