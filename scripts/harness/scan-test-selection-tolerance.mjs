#!/usr/bin/env node

/**
 * Narrowed-test-selection tolerance guard (INFRA-060).
 *
 * A CI step that runs a SUBSET of a package's tests — selected by name — is asserting that those
 * specific tests pass. If the selector matches nothing, the only honest answer is failure: the
 * step asserted something about tests that no longer exist. Reporting success is reporting a
 * verdict over ground it never covered.
 *
 * MEASURED on `ci.yml` -> `windows-shell`, the only job in the matrix that can exercise win32 at
 * all, and a REQUIRED status check on `protect-develop`:
 *
 *     pnpm --filter @robota-sdk/agent-core test -- --run platform-shell
 *
 * `agent-core`'s `test` script is `vitest run --passWithNoTests`, so the flag the CI step never
 * writes is inherited through the script indirection. Renaming `platform-shell.test.ts` to
 * `shell-resolver.test.ts` — an ordinary refactor, invisible in review — made that exact command
 * print `No test files found, exiting with code 0` and exit 0. The check stayed green having
 * executed nothing, on both of its steps, for as long as the shape existed.
 *
 * The flag cannot be overridden at the call site: vitest's cac parser rejects a repeated
 * `--passWithNoTests` outright ("Expected a single value for option ... received [true, false]"),
 * so a CI step that inherits it has no way to opt out. The fix is to stop going through the
 * script — `pnpm --filter <pkg> exec vitest run <pattern>` resolves the same per-package config
 * and exits 1 when the filter matches nothing.
 *
 * SCOPE — deliberately narrow. This flags only the combination that is unambiguously wrong: a
 * workflow step that NARROWS a test run AND routes it through a script that tolerates zero
 * matches. A whole-package `pnpm --filter <pkg> test` with no selector is NOT flagged: there
 * `--passWithNoTests` expresses a package-level policy about a package that may legitimately have
 * no tests yet, which is a different question (and a different item) from a selector that has
 * silently stopped selecting. Over-reaching here would make the guard noisy on a shape it cannot
 * prove is wrong, and a noisy gate is one people learn to bypass.
 *
 * ANTI-ROT: fails loudly when it resolves ZERO filtered package-script invocations across all
 * workflows. Every assertion is quantified over invocations the parser found, so finding none
 * means the parser broke, not that CI is clean.
 *
 * Exit code 0 = no narrowed test selection can pass on zero matches, 1 = at least one can.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { splitJobSteps } from './scan-main-required-checks.mjs';
import { splitWorkflowJobs, stripComments } from './scan-ci-base-history.mjs';
import { listWorkspaceScopes, resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const WORKFLOW_DIR = path.join('.github', 'workflows');

/** Runner flags that turn "no test file matched the selector" into a PASS. */
export const ZERO_MATCH_TOLERANT = /--passWithNoTests\b/;

/**
 * A pnpm invocation of a package script, with whatever follows it.
 *
 * Captures the package name from `--filter <pkg>` (the LAST one, so the multi-filter build shape
 * `--filter a --filter b build` resolves to the script's own trailing args either way), the script
 * name, and the remainder of the line. `run` is optional because pnpm accepts both spellings.
 */
export const FILTERED_SCRIPT_INVOCATION =
  /\bpnpm\b(?<flags>(?:\s+--filter\s+\S+)+)\s+(?:run\s+)?(?<script>[A-Za-z][\w:.-]*)(?<rest>[^\n]*)/g;

/** Script names this scan treats as running tests. */
export const TEST_SCRIPT = /^test(:|$)/;

/** List the workflow files this scan governs. */
export function listWorkflows(root = WORKSPACE_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) {
    throw new Error(`${WORKFLOW_DIR} does not exist under ${root}`);
  }
  return readdirSync(dir)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .sort()
    .map((entry) => path.join(WORKFLOW_DIR, entry));
}

/**
 * Whether what follows the script name NARROWS the run to a subset of tests.
 *
 * `-- --run platform-shell` and a bare trailing `platform-shell` both narrow. A trailing
 * `--config <file>` does not: it selects a whole PROJECT (`test:bin`, `test:pty`), whose include
 * globs are the assertion, and an empty project is a different defect from a dead selector.
 * Nothing at all does not narrow.
 */
export function narrowsSelection(rest) {
  const args = String(rest ?? '')
    .replace(/^\s*--\s+/, ' ')
    .trim();
  if (args === '') return false;
  const tokens = args.split(/\s+/).filter(Boolean);
  const narrowing = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--config' || token === '--project' || token === '--reporter') {
      index += 1; // its value is not a selector
      continue;
    }
    if (token === '--run' || token.startsWith('-')) continue; // `--run` is a MODE, not a selector
    narrowing.push(token);
  }
  return narrowing.length > 0;
}

/** Index every workspace package by its published name. */
export async function workspaceScriptsByName(root = WORKSPACE_ROOT) {
  const previous = process.cwd();
  process.chdir(root);
  try {
    const scopes = await listWorkspaceScopes();
    return new Map(
      scopes.map((scope) => [
        scope.workspaceName,
        { scripts: scope.scripts ?? {}, dir: scope.relativeDir },
      ]),
    );
  } finally {
    process.chdir(previous);
  }
}

/** Every filtered package-script invocation in a `run:` block. */
export function parseInvocations(runText) {
  const found = [];
  for (const match of String(runText ?? '').matchAll(FILTERED_SCRIPT_INVOCATION)) {
    const filters = [...match.groups.flags.matchAll(/--filter\s+(\S+)/g)].map((one) => one[1]);
    found.push({
      packages: filters,
      script: match.groups.script,
      rest: match.groups.rest ?? '',
    });
  }
  return found;
}

/** The `run:` text of a step block, if it has one. */
export function stepRun(stepText) {
  const lines = String(stepText ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^ {8}run:/.test(line));
  if (start === -1) return undefined;
  const body = [lines[start].replace(/^ {8}run:\s*\|?-?\s*/, '')];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !/^ {10}/.test(line)) break;
    body.push(line.trim());
  }
  return body.join('\n').replace(/\s+$/, '');
}

/** Findings across every workflow, plus the number of filtered invocations examined. */
export async function findTestSelectionFindings(root = WORKSPACE_ROOT) {
  const byName = await workspaceScriptsByName(root);
  const findings = [];
  let invocations = 0;

  for (const workflow of listWorkflows(root)) {
    const text = readFileSync(path.join(root, workflow), 'utf8');
    for (const job of splitWorkflowJobs(text)) {
      for (const step of splitJobSteps(job.text)) {
        const run = stepRun(stripComments(step));
        if (run === undefined) continue;
        for (const invocation of parseInvocations(run)) {
          if (!TEST_SCRIPT.test(invocation.script)) continue;
          invocations += 1;
          if (!narrowsSelection(invocation.rest)) continue;
          for (const name of invocation.packages) {
            const resolved = byName.get(name);
            if (!resolved) continue; // an unresolvable filter is check-workspace-refs' assertion
            const command = resolved.scripts[invocation.script];
            if (typeof command !== 'string' || !ZERO_MATCH_TOLERANT.test(command)) continue;
            findings.push({
              workflow,
              job: job.name,
              detail:
                `narrows \`${name}\`'s \`${invocation.script}\` to a selector (\`${invocation.rest.trim()}\`), ` +
                `but that script is \`${command}\` — it reports SUCCESS when the selector matches NOTHING. ` +
                `A rename or a move of the target test file leaves this step green having executed zero ` +
                `tests. The flag cannot be overridden at the call site (vitest rejects a repeated ` +
                `\`--passWithNoTests\`), so invoke the runner directly instead: ` +
                `\`pnpm --filter ${name} exec vitest run <pattern>\`, which resolves the same per-package ` +
                `config and exits 1 on zero matches.`,
            });
          }
        }
      }
    }
  }
  return { findings, invocations };
}

export async function main() {
  const { findings, invocations } = await findTestSelectionFindings();

  if (invocations === 0) {
    process.stdout.write(
      'test-selection-tolerance scan failed — it resolved ZERO filtered test invocations.\n' +
        'Every assertion here is quantified over invocations the parser found, so finding none means\n' +
        'the parser stopped reading the workflows, not that CI is clean.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (findings.length > 0) {
    process.stdout.write('test-selection-tolerance scan failed (INFRA-060):\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.workflow} › ${finding.job}: ${finding.detail}\n`);
    }
    process.stdout.write(
      '\nA step that selects tests by name and passes on zero matches reports a verdict over ground it\n' +
        'never covered — measured on `windows-shell`, where a rename made both steps exit 0 on no tests.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`::examined:: ${invocations} filtered test invocations\n`);
  process.stdout.write(
    `test-selection-tolerance scan passed — ${invocations} filtered test invocation(s) examined; none can pass on zero matches.\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
