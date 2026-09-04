#!/usr/bin/env node

/**
 * A runner is the most expensive place to wait.
 *
 * A job that polls — for another workflow, for an artifact, for an external service — is billed for
 * every second it spends doing nothing, because billing counts the job's wall clock and rounds it up.
 * A wait of this kind is invisible in a cost report: the workflow looks like ordinary work, and the
 * only symptom is that the same run sometimes takes seconds and sometimes many minutes.
 *
 * WHAT IT LOOKS FOR: an unbounded shell loop (`while :`, `while true`, `until …`) or a `sleep` of
 * more than a few seconds inside a workflow step. Both are the shape of "hold the runner and check
 * again later".
 *
 * WHERE THE WAIT BELONGS INSTEAD: on the agent side, at an interval, so nothing is billed while
 * nothing is happening. A gate that cannot yet decide reports that it cannot decide — which must
 * BLOCK, never pass — and is re-run once the thing it needs has completed.
 *
 * WHAT IT DOES NOT FLAG: a short settle (a few seconds); a COUNTED loop (`for i in 1 2 3; do`),
 * whose iterations are bounded by construction; and any step carrying a reasoned suppression. A build
 * that legitimately takes a long time is not a wait — this looks for loops, not for duration.
 *
 * WHAT IT FLAGS WITHOUT READING THE CONDITION, stated because the distinction is not free: EVERY
 * `until … ; do` is flagged, and so is every `while :` / `while true`. A shell `until` in a workflow
 * step is a poll predicate by construction — "keep going until the thing I am waiting for is true" —
 * and deciding from the condition text whether a particular one terminates promptly is not something
 * this can do reliably. A bounded retry that genuinely belongs in a job is written as a counted loop
 * and passes; one written as `until` carries the suppression, whose honest reason is that the author
 * checked the bound, not that the scan is wrong.
 *
 * Exit code 0 = no unsuppressed waits, 1 = findings.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const WORKFLOW_DIR = '.github/workflows';

/** A `sleep` shorter than this is a settle, not a wait held on a runner. */
const SETTLE_SECONDS = 5;

const UNBOUNDED_LOOP = /^\s*(while\s+(:|true)\s*;?\s*do|until\s+.+;\s*do)\s*$/;
const SLEEP_CALL = /(?:^|[;&|\s])sleep\s+(\d+(?:\.\d+)?)/;
const SUPPRESSION = /allow-runner-wait:\s*\S+/;

export function findRunnerWaits(source, file = 'workflow.yml') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*#/.test(line.trim()) && !UNBOUNDED_LOOP.test(line)) continue;

    let kind = null;
    if (UNBOUNDED_LOOP.test(line)) kind = 'unbounded-poll-loop';
    else {
      const sleep = SLEEP_CALL.exec(line);
      if (sleep && Number(sleep[1]) > SETTLE_SECONDS) kind = 'runner-sleep';
    }
    if (!kind) continue;

    // Suppression from the line itself or the contiguous comment block above it, matching the
    // convention the other workflow scans use.
    let suppressed = SUPPRESSION.test(line);
    for (let above = i - 1; !suppressed && above >= 0 && /^\s*#/.test(lines[above]); above -= 1) {
      suppressed = SUPPRESSION.test(lines[above]);
    }
    if (suppressed) continue;

    findings.push({ file, line: i + 1, kind, text: line.trim().slice(0, 140) });
  }
  return findings;
}

export function findAllRunnerWaits(root = WORKSPACE_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) {
    // Fail closed: a scan that examined no workflows has cleared nothing.
    throw new Error(
      `runner-wait: ${WORKFLOW_DIR} does not exist under ${root} — no workflow could be read.`,
    );
  }
  const findings = [];
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
  for (const name of files) {
    findings.push(...findRunnerWaits(readFileSync(path.join(dir, name), 'utf8'), name));
  }
  return { findings, examined: files.length };
}

function main() {
  const { findings, examined } = findAllRunnerWaits();
  if (findings.length === 0) {
    console.log(`::examined:: ${examined} workflows`);
    console.log(`runner-wait scan passed (${examined} workflow(s) examined).`);
    return;
  }
  console.error(
    `runner-wait scan failed: ${findings.length} finding(s) in ${examined} workflow(s):`,
  );
  for (const finding of findings) {
    console.error(
      `- [${finding.kind}] ${finding.file}:${finding.line}: ${finding.text}\n` +
        '  A runner bills while it waits. Move the wait to the agent side at an interval, and let the ' +
        'step report that it cannot decide yet — which must BLOCK, never pass. Deliberate exception: ' +
        '`allow-runner-wait: <reason>`.',
    );
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
