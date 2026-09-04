import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  groupFindingsByType,
  printCleanupFindings,
  writeCleanupReport,
} from './cleanup-drift-output.mjs';
import { buildSourceIndex } from './cleanup-drift-source-index.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';
import { listWorkspaceScopes, pathExists, readText, resolveWorkspaceRoot } from './shared.mjs';
import { normalizeSpecHeading, readSpecSectionContract } from './spec-sections.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta, { fromCwd: true });
const SKILLS_ROOT = path.join(WORKSPACE_ROOT, '.agents', 'skills');
const SKILLS_INDEX_PATH = path.join(SKILLS_ROOT, 'index.md');
const DESIGN_TMP_PATH = path.join(WORKSPACE_ROOT, '.design', 'tmp');

const FORBIDDEN_AGENT_TERMS = [
  /\bmain agent\b/i,
  /\bsub-agent\b/i,
  /\bparent-agent\b/i,
  /\bchild-agent\b/i,
];
const FORBIDDEN_AGENT_PREFILTER = /main agent|sub-agent|parent-agent|child-agent/;

function extractSections(content) {
  return [...content.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1].trim());
}

async function listSkillDirs() {
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function extractSkillsFromIndex(content) {
  // skills/index.md is the registry SSOT (AGENTS.md delegates to it). Rows use the
  // markdown link form `[<name>](<name>/SKILL.md)` where link text == directory name.
  const names = new Set();
  for (const match of content.matchAll(/\[([a-z0-9-]+)\]\(\1\/SKILL\.md\)/g)) {
    names.add(match[1]);
  }
  return names;
}

async function checkStaleDesignDocs(findings) {
  if (!(await pathExists(DESIGN_TMP_PATH))) {
    return;
  }

  const entries = await fs.readdir(DESIGN_TMP_PATH);
  const mdFiles = entries.filter((name) => name.endsWith('.md'));

  for (const file of mdFiles) {
    const fullPath = path.join(DESIGN_TMP_PATH, file);
    const stat = await fs.stat(fullPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

    if (ageDays > 14) {
      findings.push({
        file: `.design/tmp/${file}`,
        type: 'stale-tmp-doc',
        detail: `Temporary design document is ${ageDays} days old. Consider promoting to owner doc or removing.`,
      });
    }
  }
}

async function checkSpecQuality(findings) {
  // Fail-closed, but only where it can matter: the contract is read on the FIRST SPEC.md found, so a
  // root with no SPEC to judge does not throw (there is nothing to report silently), while a root
  // that HAS SPECs and no readable contract refuses rather than reporting them all complete
  // (enforcement-architecture.md, "Silence is not success").
  let specSections;
  const sectionContract = () => (specSections ??= readSpecSectionContract(WORKSPACE_ROOT));
  const scopes = await listWorkspaceScopes();

  for (const scope of scopes) {
    const specPath = path.join(WORKSPACE_ROOT, scope.relativeDir, 'docs', 'SPEC.md');
    if (!(await pathExists(specPath))) {
      continue;
    }

    const content = await readText(specPath);
    const sections = extractSections(content);
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length < 10) {
      findings.push({
        file: path.join(scope.relativeDir, 'docs', 'SPEC.md'),
        type: 'minimal-spec',
        detail: `SPEC.md has only ${lines.length} non-empty lines. Consider expanding per spec-writing-standard skill.`,
      });
    }

    // RULE-013: the required list is parsed from its owning skill, not copied here, and headings
    // are matched by the shared normalizer (`## 1. Scope` counts as Scope). Substring matching used
    // to accept `## Scope Notes` as `Scope` and to reject every ordinal-prefixed SPEC.
    const contract = sectionContract();
    const presentRequired = new Set(
      sections.map(normalizeSpecHeading).filter((name) => contract.required.includes(name)),
    );
    const missingSections = contract.required.filter((name) => !presentRequired.has(name));

    if (missingSections.length > 0) {
      findings.push({
        file: path.join(scope.relativeDir, 'docs', 'SPEC.md'),
        type: 'spec-missing-sections',
        detail: `Missing required sections: ${missingSections.join(', ')}`,
      });
    }
  }
}

async function checkUnregisteredSkills(findings) {
  const indexContent = await readText(SKILLS_INDEX_PATH);
  const registeredSkills = extractSkillsFromIndex(indexContent);
  const skillDirs = await listSkillDirs();

  for (const skillDir of skillDirs) {
    if (!registeredSkills.has(skillDir)) {
      findings.push({
        file: `.agents/skills/${skillDir}/`,
        type: 'unregistered-skill',
        detail: `Skill directory exists but is not listed in .agents/skills/index.md (the skills registry).`,
      });
    }
  }

  for (const registered of registeredSkills) {
    if (!skillDirs.includes(registered)) {
      findings.push({
        file: '.agents/skills/index.md',
        type: 'stale-skill-reference',
        detail: `.agents/skills/index.md references skill "${registered}" but no directory exists at .agents/skills/${registered}/.`,
      });
    }
  }
}

async function checkForbiddenTerms(findings, sourceIndex) {
  for (const file of sourceIndex) {
    if (!file.inWorkspaceSource) continue;
    const content = await file.read();
    // Preserve the old grep prefilter exactly: it was intentionally case-sensitive, while the
    // final word-boundary judge below is case-insensitive.
    if (!FORBIDDEN_AGENT_PREFILTER.test(content)) continue;
    for (const term of FORBIDDEN_AGENT_TERMS) {
      if (term.test(content)) {
        findings.push({
          file: file.relative,
          type: 'forbidden-agent-term',
          detail: `Contains forbidden agent hierarchy term matching: ${term.source}`,
        });
        break;
      }
    }
  }
}

/**
 * Does this file contain a REAL blind assertion, as an AST node rather than as text?
 *
 * The text form counted a docblock EXPLAINING the rule as a violation of it. Measured: while
 * ARCH-029 landed, `command-host-double.ts` and `agent-job-host-double.ts` — the conformant,
 * cast-free doubles built to REMOVE those assertions — were both flagged, because each explains in
 * prose why it exists. Splitting one file into two raised the frozen count by one. It was worked
 * around by rewording the prose, which puts the pressure on the documentation instead of the code
 * and leaves the next accurate docblock to trip it again.
 *
 * The same defect was fixed once already in this repository: `scan-subagent-runner-composition.mjs`
 * moved from a regex to `lib/ts-ast.mjs` for exactly this reason, and its test file carries a case
 * named "does NOT flag prose that merely names the symbols". This follows that precedent.
 *
 * `as unknown as T` parses as `AsExpression(AsExpression(expr, unknown), T)`, so the OUTER node is
 * found by asking whether its own expression is an `unknown` assertion — which is why the two kinds
 * are not one predicate with a different string.
 */
export function hasBlindAssertion(sourceText, fileName, kind) {
  let found = false;
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const typeTextOf = (node) => (node.type ? node.type.getText().trim() : '');
  const visit = (node) => {
    if (found) return;
    if (ts.isAsExpression(node)) {
      if (kind === 'any' && typeTextOf(node) === 'any') found = true;
      else if (
        kind === 'unknown' &&
        node.expression &&
        ts.isAsExpression(node.expression) &&
        typeTextOf(node.expression) === 'unknown'
      ) {
        found = true;
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

const BOUNDARY_ASSERTION_PATTERNS = [
  {
    prefilter: /\bas any\b/,
    kind: 'any',
    type: 'blind-assertion-any',
    detail: 'Blind `as any` assertion in production code.',
  },
  {
    prefilter: /\bas unknown as\b/,
    kind: 'unknown',
    type: 'blind-assertion-unknown',
    detail: 'Blind `as unknown as T` assertion in production code.',
  },
];
function isBoundaryProductionFile(file) {
  return (
    file.underPackages &&
    !file.excludedFromBoundary &&
    !file.relative.includes('.test.') &&
    !file.relative.includes('.spec.') &&
    !file.relative.includes('__tests__') &&
    !file.relative.includes('node_modules')
  );
}

async function checkBoundaryValidation(findings, sourceIndex) {
  // Scan for blind type assertions in production code (not tests).
  //
  // Word-anchored (issue #1803). Unanchored, `as any` matched INSIDE ordinary words — `w[as any]thing`,
  // `h[as any] way` — so English prose in a docblock counted as a type assertion. That was not a rare
  // edge: at the time this was anchored, BOTH files the unanchored pattern reported were comments, and
  // the true count of blind `as any` assertions in production code under packages/ was zero. A detector
  // whose entire measured population is false positives cannot be read as evidence of anything, and it
  // punished writing the comment that explains the code.
  //
  // #1803 also covers a second false-positive class this does not fix: a REAL `as any` written inside a
  // comment (quoting the pattern to explain it) still counts. That needs comment-stripping, not a
  // boundary, so it stays open.
  for (const { prefilter, type, detail, kind } of BOUNDARY_ASSERTION_PATTERNS) {
    for (const file of sourceIndex) {
      if (!isBoundaryProductionFile(file)) continue;

      const content = await file.read();
      // The text search is the cheap prefilter; the AST is the judge. A file whose only match is in a
      // comment or a string literal has no assertion to report.
      if (!prefilter.test(content) || !hasBlindAssertion(content, file.relative, kind)) continue;

      findings.push({
        file: file.relative,
        type,
        detail,
      });
    }
  }

  // A third grep ran here — a coarse "silent fallback" pattern whose result was assigned to a
  // variable and never read, under a comment calling the detection advisory. It spawned a full
  // recursive search of `packages/` on every run and reported nothing to anybody, which is the
  // silence this file is being fixed for wearing its own uniform. Deleted rather than wired up:
  // `scan-no-fallback.mjs` (HARNESS-028) owns that rule with a real gate behind it.
}

async function checkDynamicImports(findings, sourceIndex) {
  for (const file of sourceIndex) {
    if (
      !file.underPackages ||
      file.relative.includes('.test.') ||
      file.relative.includes('.spec.') ||
      file.relative.includes('__tests__')
    ) {
      continue;
    }

    const content = await file.read();
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (!/await import\(|= import\(/.test(line)) continue;
      // The old grep output was `<file>:<line>:<content>`, and its exclusions were applied to that
      // whole string. Keep that behavior, including the unusual case where source text itself names
      // one of the excluded markers.
      const matchedLine = `${file.relative}:${index + 1}:${line}`;
      if (
        matchedLine.includes('.test.') ||
        matchedLine.includes('.spec.') ||
        matchedLine.includes('__tests__')
      ) {
        continue;
      }
      findings.push({
        file: file.relative,
        type: 'dynamic-import',
        detail: `Dynamic import detected. Verify this is for an optional module with explicit error handling.`,
      });
    }
  }
}

function parseCleanupArgs(argv) {
  const options = {
    reportFile: null,
    reportFormat: null,
    writeBaseline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--':
        break;
      case '--report-file': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--report-file requires a value');
        }
        options.reportFile = value;
        index += 1;
        break;
      }
      case '--report-format': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('--report-format requires a value');
        }
        if (value !== 'json') {
          throw new Error('--report-format must be: json');
        }
        options.reportFormat = value;
        index += 1;
        break;
      }
      // Read here rather than straight off `process.argv`, so every flag this script honours is
      // owned by one function: the first version tested it inline in `main` and returned early, so
      // `--write-baseline --report-file X` silently wrote no report.
      case '--write-baseline':
        options.writeBaseline = true;
        break;
      default:
        break;
    }
  }

  return options;
}

async function collectCleanupFindings() {
  // The shared helper, not a local one. A same-named copy here would break the property that module
  // is FOR: `requireGovernedTree` greps to "which scans have been through the HARNESS-052 sweep", and
  // a private twin makes that answer wrong — the one-owner violation HARNESS-068 is about, in the
  // same change.
  requireGovernedTree(WORKSPACE_ROOT, 'packages', {
    scan: 'cleanup-drift',
    why: 'Three of the four ratchet rows are counted from packages/, so without it every pattern matches nothing and the verdict reads "drift FELL".',
  });
  const findings = [];
  const sourceIndex = await buildSourceIndex(WORKSPACE_ROOT);

  await Promise.all([
    checkStaleDesignDocs(findings),
    checkSpecQuality(findings),
    checkUnregisteredSkills(findings),
    checkForbiddenTerms(findings, sourceIndex),
    checkBoundaryValidation(findings, sourceIndex),
    checkDynamicImports(findings, sourceIndex),
  ]);
  findings.sort((a, b) => a.type.localeCompare(b.type) || a.file.localeCompare(b.file));
  return findings;
}

async function main() {
  const options = parseCleanupArgs(process.argv.slice(2));
  const findings = await collectCleanupFindings();
  const typeGroups = groupFindingsByType(findings);
  // Under --write-baseline there IS no verdict: the run exists to record what it measured, not to
  // judge it against what was recorded before. Saying `passed: true` there would publish a pass
  // nothing checked.
  const verdict = options.writeBaseline ? undefined : publishVerdict(typeGroups);
  printCleanupFindings(findings, typeGroups, verdict);
  await writeCleanupReport(WORKSPACE_ROOT, options.reportFile, findings, verdict);

  // Last, so whoever freezes a baseline has just seen the details and the report they are freezing.
  if (options.writeBaseline) writeDriftBaseline(typeGroups);
}

/**
 * Types whose count comes from the CLOCK rather than from the tree, and so cannot be ratcheted.
 *
 * `stale-tmp-doc` counts files in `.design/tmp/` older than 14 days by mtime. Two different runs of
 * the same commit disagree: a fresh CI checkout resets every mtime, so the row can never reach the
 * threshold there, while a working copy whose `.design/tmp/` files have sat past 14 days WOULD turn
 * `pnpm harness:test` red with no code change — the state this exclusion exists to prevent, not one
 * the tree is in. A ratchet is a claim about a COMMIT; a number that
 * changes while the commit does not is not one.
 *
 * Excluded from the comparison, not from the report — the finding is still printed and still counted
 * in `findingCount`. If this row ever needs enforcing, derive the age from git rather than mtime.
 */
const CLOCK_DERIVED_TYPES = new Set(['stale-tmp-doc']);

/**
 * HARNESS-069: publish the verdict this script already computes.
 *
 * It reported findings and exited 0 — no `process.exit`, no `process.exitCode`, zero matches for
 * either. Whatever it found, a caller heard success. The intent was never ambiguous: the JSON report
 * it writes carries `passed: driftCount === 0`, so the verdict existed and simply was not published.
 * "Silence is not success" is a rule of this harness, and this was the one script that could only
 * succeed.
 *
 * A RATCHET rather than a flat gate, for the usual reason: there are findings today (see the frozen
 * baseline), and a check that is red on arrival is suppressed rather than obeyed. The per-type counts
 * may fall and must never rise.
 *
 * WHERE IT IS ENFORCED: `scripts/harness/README.md`, under `pnpm harness:cleanup`, owns that answer,
 * and it is not repeated here. It is not in `run-all-scans.mjs`, from which the first version of this
 * comment concluded "not registered as a gate, and that is deliberate" — false. The second version
 * said "unconditionally in the `scans` job" — also false; that job is itself conditional. Three
 * copies of one fact, and the correction reached two of them. That is why there is now one.
 *
 * A rise therefore fails CI. Going up is not mechanically impossible — `--write-baseline` freezes
 * whatever it measures — it is visible: the raised number lands in a tracked file, in the diff, under
 * review. That is the same discipline every other ratchet in this harness runs on.
 */
function publishVerdict(typeGroups) {
  announceBaselineOverride();
  const baseline = loadDriftBaseline();
  if (baseline === undefined) {
    process.stderr.write(
      `no frozen drift baseline — run \`node ${path.relative(WORKSPACE_ROOT, import.meta.filename)} --write-baseline\`.\n`,
    );
    process.exitCode = 1;
    return { ok: false, grown: [], shrunk: [] };
  }

  const grown = [];
  const shrunk = [];
  for (const [type, count] of typeGroups) {
    if (CLOCK_DERIVED_TYPES.has(type)) continue;
    const frozen = baseline[type] ?? 0;
    if (count > frozen) grown.push(`${type}: ${count} (frozen ${frozen})`);
  }
  for (const [type, frozen] of Object.entries(baseline)) {
    if (CLOCK_DERIVED_TYPES.has(type)) continue;
    const count = typeGroups.get(type) ?? 0;
    if (count < frozen) shrunk.push(`${type}: ${frozen} → ${count}`);
  }

  // BOTH are reported when both happened. The first version returned after the growth, so a run that
  // grew one type and shrank another printed only half of what it knew and the operator fixed the
  // growth, re-ran, and met the re-freeze demand as a surprise. A verdict that withholds what it
  // measured is the same defect as one that never measured it.
  if (grown.length > 0) {
    process.stderr.write(`\ndrift GREW: ${grown.join(', ')}\n`);
  }
  if (shrunk.length > 0) {
    process.stderr.write(
      `\ndrift FELL (${shrunk.join(', ')}). Re-freeze it in the SAME change — ` +
        `--write-baseline — or the gain is a licence to grow back.\n`,
    );
  }
  if (grown.length > 0 || shrunk.length > 0) {
    process.exitCode = 1;
    return { ok: false, grown, shrunk };
  }
  return { ok: true, grown, shrunk };
}

/**
 * The frozen baseline, overridable for tests.
 *
 * `CLEANUP_DRIFT_BASELINE` exists so the ratchet's own cases can point at a temp file instead of
 * editing the tracked baseline and restoring it in `afterEach` — a restore a timeout or a SIGKILL
 * never runs, leaving the repository's frozen counts corrupted. Same shape as `GUARD_LEDGER_CEILINGS`
 * in `scan-guard-scope-fail-closed.mjs`, for the same reason — INCLUDING its loud notice, because a
 * silent override is the failure this file is being fixed for: a run against an untracked baseline
 * would otherwise print a verdict indistinguishable from the real one. `--write-baseline` never
 * reaches `publishVerdict` and so never reaches that notice — it prints the resolved path instead.
 */
function driftBaselinePath() {
  const override = process.env['CLEANUP_DRIFT_BASELINE'];
  return override !== undefined && override !== ''
    ? path.resolve(WORKSPACE_ROOT, override)
    : path.join(WORKSPACE_ROOT, 'scripts/harness/cleanup-drift-baseline.json');
}

/**
 * Say so, on pass and on fail, whenever the run was not judged against the tracked baseline.
 *
 * The emptiness test matches `driftBaselinePath` exactly. With `CLEANUP_DRIFT_BASELINE=` set empty,
 * a `!== undefined` check here would announce "this run did NOT check the frozen counts" about a run
 * that checked them — a notice asserting the opposite of what happened.
 */
function announceBaselineOverride() {
  const override = process.env['CLEANUP_DRIFT_BASELINE'];
  if (override === undefined || override === '') return;
  process.stderr.write(
    `cleanup-drift: baseline OVERRIDDEN via CLEANUP_DRIFT_BASELINE=${driftBaselinePath()} — this ` +
      'run did NOT check the frozen counts, and its verdict says nothing about the repository.\n',
  );
}

function loadDriftBaseline() {
  try {
    return JSON.parse(fsSync.readFileSync(driftBaselinePath(), 'utf8'));
  } catch (error) {
    // Absent is "never frozen", which the caller reports. Anything else is a real read failure and
    // must not be mistaken for it.
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Freeze the current per-type drift counts. The set may fall and must never rise.
 *
 * Clock-derived types are filtered here too, not only in the comparison: a freeze run on a machine
 * with an aged `.design/tmp/` would otherwise write a number into the tracked baseline that no other
 * checkout can reproduce, which is exactly what `CLOCK_DERIVED_TYPES` says a baseline must not hold.
 *
 * The resolved PATH is printed, because this is the one route that skips `publishVerdict` and so
 * skips its override notice — without the path, `CLEANUP_DRIFT_BASELINE=/tmp/x --write-baseline`
 * would report a freeze while the tracked file sat untouched.
 */
function writeDriftBaseline(typeGroups) {
  const next = Object.fromEntries(
    [...typeGroups.entries()].filter(([type]) => !CLOCK_DERIVED_TYPES.has(type)).sort(),
  );
  const target = driftBaselinePath();
  fsSync.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(
    `drift baseline frozen in ${path.relative(WORKSPACE_ROOT, target) || target}: ${JSON.stringify(next)}\n`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
