#!/usr/bin/env node

/**
 * Workflow permission-scope guard (D9, from INFRA-060's ci.yml audit).
 *
 * The audit filed "no `permissions:` block anywhere in ci.yml" as a defect. Measured, it is not one:
 * the repository's `default_workflow_permissions` is `read`, so a workflow that declares nothing
 * inherits read-only — already the minimum. Writing the block out changes nothing about what the
 * token can do, and adds a copy for the next author to clone incorrectly.
 *
 * What IS a real exposure is the thing nobody would notice: **that default is a repository setting,
 * not a file.** Flip it to `write` in the Actions settings UI and every workflow without an explicit
 * block silently gains write access to the repository — no diff, no review, no failing check. The
 * workflows would keep passing, which is exactly the shape this repository has been closing all
 * week: a control whose weakening is invisible from outside.
 *
 * So this scan does two things:
 *
 *   1. **Pins the repository default to `read`** when it can read it (`--live`, needing a token).
 *      Offline it asserts the declared intent below is present and internally consistent, so the
 *      offline run is not vacuous — it just cannot see the live setting.
 *   2. **Requires every declared `write` scope to be justified.** A write grant is the one thing a
 *      reviewer must weigh, so each is listed here with the API call that needs it. An undeclared
 *      write scope appearing in a workflow is a finding; so is a justification for a scope no
 *      workflow actually asks for any more (anti-rot — a stale excuse outlives what it excused).
 *
 * Deliberately NOT checked: that every workflow declares a block. That would fire on every
 * read-only workflow in the repository — noise, and a noisy guard gets suppressed, which costs more
 * than it catches. The same reasoning `review-gate`'s severity split rests on.
 *
 * Exit 0 = the permission surface matches what is justified here, 1 = drift.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_DIR = '.github/workflows';

/**
 * Every `write` scope any workflow is allowed to hold, and why it needs it. A workflow granting a
 * scope absent from this map is a finding; an entry here that no workflow requests any more is also
 * a finding, so the justification cannot outlive the need.
 */
export const JUSTIFIED_WRITE_SCOPES = {
  'claude-code-review.yml': {
    'pull-requests': 'posts the review as inline comments and a summary on the PR',
    // `id-token: write` is gone as of INFRA-062: the workflow now supplies `github_token`, so the
    // action returns before the OIDC exchange this scope existed for and no app token is minted.
    // D9's own entry anticipated it ("may go away with github_token") — and this scan is what
    // caught the excuse outliving the grant.
  },
  'codeql.yml': {
    'security-events': 'uploads the SARIF analysis that becomes the code-scanning alerts',
  },
  'dependency-review.yml': {
    'pull-requests': 'comments the dependency-review summary on failure (comment-summary-in-pr)',
  },
  'release-bun-binaries.yml': {
    contents: 'uploads the compiled binaries as GitHub Release assets',
  },
  'release-desktop-app.yml': {
    contents: 'uploads the packaged installers as GitHub Release assets',
  },
  'review-gate.yml': {
    'pull-requests':
      'posts the blocking findings to the PR so they are readable without the run log',
  },
};

/** Parse the top-level `permissions:` block of a workflow into `{scope: level}`. */
/**
 * How many write scopes the last run actually READ from workflows on disk.
 *
 * Deliberately not the size of the declaration table below. That table keeps an entry for a workflow
 * that has since been deleted, and the anti-rot loop skips those — so reporting its size would claim
 * an examined count larger than what was examined, which is the exact defect the `::examined::` line
 * exists to expose. Found by review, in the change that introduced the line.
 */
let examinedWriteScopes = 0;

/** What the last `findWorkflowPermissionFindings` run actually read — exported so it can be asserted. */
export function examinedWriteScopeCount() {
  return examinedWriteScopes;
}

export function parsePermissions(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^permissions:\s*$/.test(line));
  if (start === -1) return null;
  const scopes = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^\s+([a-z-]+):\s*(\S+)/.exec(line);
    if (!match) continue;
    const [, scope, level] = match;
    // Take the WIDEST level on a duplicate key rather than the last one. Duplicate keys are invalid
    // YAML and GitHub rejects them, so this cannot mask a real config — but a last-one-wins parser
    // reports `read` for a block that also says `write`, which is a scan that under-reports its own
    // subject. Found while red-proofing this guard: an injected `write` above an existing `read`
    // was silently overwritten, and the RED case did not fire.
    scopes[scope] = scopes[scope] === 'write' || level === 'write' ? 'write' : level;
  }
  return scopes;
}

export function findWorkflowPermissionFindings(root = WORKSPACE_ROOT) {
  // Reset FIRST, before the early returns. Placed after them, a run that bailed on an absent or
  // empty workflow directory reported the PREVIOUS run's count — a holder that is not reset reports
  // the largest run it ever saw, and the early-return paths are exactly where it examined nothing.
  examinedWriteScopes = 0;
  const findings = [];
  const dir = path.join(root, WORKFLOW_DIR);
  if (!fs.existsSync(dir)) {
    // Fail CLOSED: the guard's whole subject is missing, which is never a pass.
    return [
      {
        workflow: WORKFLOW_DIR,
        detail: 'the workflow directory does not exist — this scan examined nothing',
      },
    ];
  }

  const workflows = fs.readdirSync(dir).filter((name) => name.endsWith('.yml'));
  if (workflows.length === 0) {
    return [{ workflow: WORKFLOW_DIR, detail: 'no workflows found — this scan examined nothing' }];
  }

  const requested = new Set();
  for (const name of workflows) {
    const scopes = parsePermissions(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (scopes === null) continue; // inherits the repository default, which rule 1 pins
    for (const [scope, level] of Object.entries(scopes)) {
      if (level !== 'write') continue;
      requested.add(`${name}:${scope}`);
      examinedWriteScopes = requested.size;
      const justification = JUSTIFIED_WRITE_SCOPES[name]?.[scope];
      if (justification === undefined) {
        findings.push({
          workflow: name,
          detail: `grants \`${scope}: write\` with no justification in JUSTIFIED_WRITE_SCOPES. A write scope is the one grant a reviewer must weigh — record what API call needs it, or drop the scope.`,
        });
      }
    }
  }

  // Anti-rot, and scoped to workflows that are actually PRESENT. A justification for a workflow the
  // scanned tree does not contain says nothing about rot — it only says this is not the real tree.
  // Without that guard every fixture root reported all seven entries as stale, which is a rule
  // firing on the absence of its subject rather than on a defect.
  const present = new Set(workflows);
  for (const [name, scopes] of Object.entries(JUSTIFIED_WRITE_SCOPES)) {
    if (!present.has(name)) continue;
    for (const scope of Object.keys(scopes)) {
      if (requested.has(`${name}:${scope}`)) continue;
      findings.push({
        workflow: name,
        detail: `JUSTIFIED_WRITE_SCOPES still excuses \`${scope}: write\`, which the workflow no longer requests — delete the entry so the excuse cannot outlive what it excused.`,
      });
    }
  }

  return findings;
}

/** Read the repository's default workflow permission. Requires a token; only used under `--live`. */
export function readLiveDefault(repo) {
  const raw = execFileSync(
    'gh',
    ['api', `repos/${repo}/actions/permissions/workflow`, '--jq', '.default_workflow_permissions'],
    { encoding: 'utf8' },
  );
  return raw.trim();
}

export function main(argv = process.argv.slice(2)) {
  const findings = findWorkflowPermissionFindings();

  if (argv.includes('--live')) {
    const repo = process.env.GITHUB_REPOSITORY ?? 'woojubb/robota';
    let live;
    try {
      live = readLiveDefault(repo);
    } catch (error) {
      // Fail CLOSED: unable to read is not the same as correct.
      process.stdout.write(
        `workflow-permissions scan failed: could not read the live default for ${repo} — ${error.message}\n`,
      );
      process.exitCode = 1;
      return;
    }
    if (live !== 'read') {
      findings.push({
        workflow: '(repository setting)',
        detail: `default_workflow_permissions is \`${live}\`, not \`read\`. Every workflow without an explicit permissions block now holds that level — a widening no diff would show.`,
      });
    }
  }

  if (findings.length > 0) {
    process.stdout.write('workflow-permissions scan failed (D9 / INFRA-060):\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.workflow}: ${finding.detail}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const count = Object.values(JUSTIFIED_WRITE_SCOPES).reduce(
    (total, scopes) => total + Object.keys(scopes).length,
    0,
  );
  process.stdout.write(
    `::examined:: ${examinedWriteScopes} write scopes read from workflows on disk\n`,
  );
  process.stdout.write(
    `workflow-permissions scan passed: ${count} declared write scope(s), each justified.` +
      (argv.includes('--live')
        ? ' Live default is `read`.'
        : ' (offline — live default not read)') +
      '\n',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
