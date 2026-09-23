#!/usr/bin/env node
/**
 * Run every harness scan and report ALL results in one pass.
 *
 * Lesson source: the previous `&&` chain stopped at the first failing scan,
 * masking every scan behind it — pre-existing background-workspace findings
 * failed unseen on every release until an unrelated fix unmasked them
 * (HARNESS-011, 2026-06-11). A real NEW failure must never hide behind a
 * known baseline failure.
 *
 * Exit code 0 = all scans passed, 1 = at least one scan failed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyRange } from './classify-changed-paths.mjs';
import {
  errorDetail,
  normalizeScanOutcome,
  publicationUnavailableDiagnostic,
  publishDiagnosticResults,
  scanFindingDiagnostic,
  scanUnavailableDiagnostic,
} from './diagnostic-run-adapter.mjs';
import { deliverHookDiagnosticReport } from './hook-diagnostic-adapter.mjs';
import { collectHookDiagnosticInventoryResults } from './hook-diagnostic-producer.mjs';
import { collectFiles } from './enumerate-files.mjs';
import {
  ADVISORY_MARKER,
  EXAMINED_MARKER,
  EXPECTED_EMPTY_MARKER,
  extractAdvisories,
  extractExamined,
} from './output-markers.mjs';
import {
  applyScanSuccessCache,
  inspectScanSuccessCache,
  recordSuccessfulScanResults,
} from './scan-receipt.mjs';
import { resolveBaseRef, resolveWorkspaceRoot } from './shared.mjs';
import { SOURCE_EXTENSIONS } from './workspace-packages.mjs';
const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
/**
 * Sentinel a scan prints to mark ONE line as an ADVISORY finding (HARNESS-053).
 *
 * THE GAP THIS CLOSES, measured. Passing scans' output is discarded — `expect(out).not.toContain
 * ('quiet pass')` is a pinned property of this runner, and a correct one: 78 scans printing their
 * successes is noise nobody reads. But it left no third channel, so a scan that measured something
 * worth saying while still passing had nowhere to say it. Measured on the real path:
 * `touch packages/agent-core/src/index.ts && pnpm harness:scan | grep -i stale` printed NOTHING,
 * while the `dist` scan had detected and reported the staleness. A finding nobody sees is not a
 * finding, and this is the exact sequence that cost a misdiagnosis cycle: run `harness:scan`, see
 * green, conclude the branch is healthy, then blame missing barrel exports for a stale `dist`.
 *
 * WHY A LINE MARKER RATHER THAN AN EXIT CODE. Advisories must not be able to change a scan's
 * verdict — a second non-zero code would eventually be treated as failure by something downstream,
 * and then "advisory" becomes blocking by accident. A marker is opt-in per LINE, so a scan chooses
 * exactly which of its output reaches the summary and the rest stays suppressed as before.
 *
 * GENERAL, not a special case for one scan: any scan may print it, and several in this repo have
 * advisory output currently thrown away (e.g. `scan-dist-freshness`'s staleness notices).
 */
// Shared output markers used by scan implementations and their focused tests.
export {
  ADVISORY_MARKER,
  EXAMINED_MARKER,
  EXPECTED_EMPTY_MARKER,
  extractAdvisories,
  extractExamined,
};
/**
 * HOW MUCH DID YOU LOOK AT? — the one question three recurring defects all answer wrongly.
 *
 * A check reporting success over work it never did is the most-repeated defect in this repository,
 * and it arrives in three costumes: a fail-open over an absent tree (`dist/ present on all 0
 * package(s)`, exit 0), a SKIP rendered as a tick and counted toward "all N scans passed", and a
 * shallow walk claiming "all" over a subset. Each was repaired one instance at a time, because
 * nothing asked the question they share.
 *
 * A scan declares the size of the subject it examined:
 *
 *   ::examined:: 24 rule documents
 *   ::examined:: 0 live planning documents ::expected-empty:: the pipeline is dormant by design
 *
 * ZERO IS A FAILURE unless the scan says why zero is correct. That is the whole mechanism: an absent
 * tree reports 0, a skip reports 0, and a subset walk reports a number a reader can compare against
 * the workspace at a glance.
 *
 * The expected-empty declaration is a REVIEWABLE LINE, not a silent default — a scan that may
 * legitimately find nothing says so in its own output, where the next reader meets it, rather than in
 * a configuration file nobody opens.
 *
 * A MARKER RATHER THAN PROSE, for the reason the advisory channel already gives: prose is guessed at
 * with a regex, and a regex over prose both misses and invents. Eighteen scans already state a size
 * in a sentence; those sentences stay for humans, and the marker is what the runner reads.
 */
/**
 * The verdict on one scan's declarations: what it examined, and whether a zero was earned.
 *
 * A scan that declares nothing is NOT failed here. Seventy-nine of them declare nothing today, and a
 * check that turns the whole suite red on arrival is suppressed rather than obeyed — adoption is held
 * by the ratchet below instead, which can only move one way.
 */
export function judgeExamined(name, output) {
  const declarations = extractExamined(output);
  const problems = [];
  const skipped = declarations.some((d) => d.size === 0 && Boolean(d.expectedEmpty));
  for (const d of declarations) {
    if (d.size === null) {
      problems.push(
        `${name}: declared an examined size that is not a number (\`${d.subject}\`), so it measures nothing.`,
      );
      continue;
    }
    if (d.size === 0 && !d.expectedEmpty) {
      problems.push(
        `${name}: examined 0 ${d.subject || 'subjects'} and did not say why zero is correct. ` +
          `A pass over nothing is not a pass — declare it with \`${EXPECTED_EMPTY_MARKER} <reason>\` if it is.`,
      );
    }
  }
  return { declared: declarations.length > 0, skipped, problems };
}
/**
 * WHICH scans declare what they examined — a ratchet, and the reason it is one.
 *
 * Most scans declare nothing today. Demanding a declaration from all of them at once turns the suite
 * red on arrival, and a suite that is red on arrival is skipped rather than fixed. So the SET of
 * declaring scans is frozen: a scan may JOIN it, and one already in it must never stop declaring. A
 * change is re-frozen in the same commit, or the gain is a licence to slide back.
 *
 * A frozen SET, not a single count, because the population is variable (HARNESS-081): the CI `scans`
 * job runs `--skip dist --skip build-contracts`, and a no-build local run self-skips the same
 * dist-dependent scans. A count over a shifting population can only be checked when the population is
 * whole — which is never, in CI — so the check that existed never bound where it mattered. A set is
 * SUBTRACTABLE: a scan that did not run (or self-skipped for want of a subject) is simply not judged
 * this pass, while every scan that DID run is held to whether the frozen set expected it to declare.
 *
 * The baseline lives beside the runner rather than inside it, so changing it is a reviewable diff and
 * not an edit to the thing doing the judging.
 */
export const EXAMINED_ADOPTION_BASELINE_PATH = path.join(
  WORKSPACE_ROOT,
  'scripts/harness/examined-adoption-baseline.json',
);
/**
 * @param declaringNames  scans that RAN and emitted `::examined::` (an earned zero counts)
 * @param evaluableNames  scans that RAN (the population this pass can judge)
 * A `--skip`'d scan never reaches here, so a frozen scan absent this pass is not a regression — only
 * a frozen scan that RAN and stopped emitting the marker is. An earned-zero declarer stays in
 * `declaringNames`, so a dormant-by-design scan is not read as a fall.
 */
export function judgeExaminedAdoption(
  declaringNames,
  evaluableNames,
  knownNames = null,
  readBaseline = defaultReadAdoption,
) {
  const frozen = readBaseline();
  if (frozen === null) {
    return {
      ok: false,
      message: `✗ no frozen examined-size adoption baseline — write ${path.relative(WORKSPACE_ROOT, EXAMINED_ADOPTION_BASELINE_PATH)}.`,
    };
  }
  const frozenSet = new Set(frozen);
  const declaring = new Set(declaringNames);
  const evaluable = new Set(evaluableNames);
  // When it is not supplied (fixture callers), the GONE check is simply skipped.
  const known = knownNames === null ? null : new Set(knownNames);
  const rel = path.relative(WORKSPACE_ROOT, EXAMINED_ADOPTION_BASELINE_PATH);
  // FELL: a scan the frozen set expects to declare, which ran this pass but did not.
  const fell = [...frozenSet].filter((name) => evaluable.has(name) && !declaring.has(name)).sort();
  // ROSE: a scan that declared this pass but is not yet frozen.
  const rose = [...declaring].filter((name) => !frozenSet.has(name)).sort();
  // GONE: a frozen scan that is no longer a registered scan at all.
  const gone = known === null ? [] : [...frozenSet].filter((name) => !known.has(name)).sort();
  const parts = [];
  if (fell.length > 0) {
    parts.push(
      `FELL: ${fell.length} scan(s) stopped declaring what they examined (${fell.join(', ')}) — a ` +
        'scan whose declaration vanished has a green that no longer means anything measurable. ' +
        `Restore it, or drop it from ${rel} in the SAME change with a reason.`,
    );
  }
  if (rose.length > 0) {
    parts.push(
      `ROSE: ${rose.length} newly-declaring scan(s) (${rose.join(', ')}) not in the frozen set. Add ` +
        `them to ${rel} in the SAME change (or run --write-adoption-baseline), or the gain is a ` +
        'licence to slide back.',
    );
  }
  if (gone.length > 0) {
    parts.push(
      `GONE: ${gone.length} frozen scan(s) (${gone.join(', ')}) are no longer registered scans at ` +
        `all. Prune them from ${rel} (or run --write-adoption-baseline) so the set cannot rot around ` +
        'a name nothing can ever satisfy.',
    );
  }
  if (parts.length > 0) {
    return { ok: false, message: `✗ examined-size adoption drift —\n  ${parts.join('\n  ')}` };
  }
  return { ok: true, message: null };
}
function defaultReadAdoption() {
  try {
    const parsed = JSON.parse(readFileSync(EXAMINED_ADOPTION_BASELINE_PATH, 'utf8')).declaring;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
/**
 * Re-freeze the baseline from an observed pass (invoked by `--write-adoption-baseline`). MERGES: for
 * scans that were evaluable this pass, take the observed declaring status; for scans NOT evaluated
 * (skipped or subject-less this run — e.g. dist scans under `--skip dist`), KEEP their frozen entry.
 * So the baseline stays correct whichever invocation regenerates it, rather than dropping the
 * dist-dependent scans whenever it is written from a CI-shaped run.
 */
export function writeAdoptionBaseline(
  declaringNames,
  evaluableNames,
  knownNames = null,
  readBaseline = defaultReadAdoption,
  writeFile = defaultWriteAdoption,
) {
  const frozen = new Set(readBaseline() ?? []);
  const evaluable = new Set(evaluableNames);
  const known = knownNames === null ? null : new Set(knownNames);
  // Keep frozen entries for scans this pass did not evaluate — they are neither confirmed nor
  // refuted — EXCEPT a name that is no longer a registered scan at all, which is pruned: keeping it
  // would re-freeze a name nothing can ever satisfy.
  const kept = [...frozen].filter(
    (name) => !evaluable.has(name) && (known === null || known.has(name)),
  );
  const merged = [...new Set([...kept, ...declaringNames])].sort();
  writeFile(merged);
  return merged;
}

/**
 * INFRA-057: command-owned scans may not be able to edit their own stdout (for example a package
 * script or an external validator). The registry's `examines` declaration is the runner-owned
 * subject boundary for those commands, so the aggregator supplies the measured subject cardinality
 * when the command did not emit a marker itself. Native scan markers always win and remain the
 * preferred, more precise form.
 */
export function ensureExaminedDeclaration(scan, output) {
  const text = String(output ?? '');
  if (text.includes(EXAMINED_MARKER)) return text;
  const count = Array.isArray(scan.examines) && scan.examines.length > 0 ? scan.examines.length : 1;
  return `${text}${text.endsWith('\n') || text.length === 0 ? '' : '\n'}${EXAMINED_MARKER} ${count} registered subject boundary(ies)`;
}
function defaultWriteAdoption(names) {
  writeFileSync(
    EXAMINED_ADOPTION_BASELINE_PATH,
    `${JSON.stringify({ declaring: names }, null, 2)}\n`,
  );
}

/**
 * Default scan concurrency (INFRA-037). Each scan is an independent, read-only subprocess, so they run
 * concurrently under a bounded pool instead of one-at-a-time. Cap leaves one core for the parent.
 */
const DEFAULT_SCAN_CONCURRENCY = Math.max(
  1,
  (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) -
    1,
);

/**
 * Ordered scan list — mirrors the former harness:scan chain.
 *
 * EXPORTED (HARNESS-052) so a scan can ask whether it is registered by reading this ARRAY rather
 * than by grepping this file's text. `check-test-coverage-scripts` proved its own wiring with
 * `readFileSync(run-all-scans.mjs).includes('check-test-coverage-scripts.mjs')`, which stays true
 * when the registration is commented out, deleted from the array but named in a comment, or
 * mentioned in this very docstring. A presence-of-a-string standing in for a structural property is
 * the sub-shape that item's second axis is about; the structure is here, so read the structure.
 *
 * WHAT EACH SCAN READS (PROC-016). Every entry declares its subject, so `--affected` can select the
 * scans a change can reach instead of running all of them on every pull request:
 *
 *   examines: [...globs]   the workspace-relative paths the scan reads — its governed tree, its path
 *                          constants, the directories it enumerates. DERIVED FROM THE SCAN'S SOURCE,
 *                          not from its name; a glob that is wider than the scan's real subject costs
 *                          a spurious run, a glob that is narrower costs a missed finding, so the
 *                          wider reading wins every tie.
 *   always: true           the scan reads outside the tree or across it — git history, a diff against
 *                          the base, transcripts, cited paths that may live anywhere — or its subject
 *                          could not be pinned to a glob. It runs on every change. Unsure ⇒ always.
 *   cacheable: true        an audited, narrower claim: the verdict depends only on the tracked tree
 *                          plus the execution identity in scan-receipt.mjs. Omitted ⇒ never cache.
 *   contexts: [...]        run only in the named suite context(s). Omitted ⇒ every context.
 *   localOnly: true        requires host-local evidence unavailable on CI runners.
 *   advisory: true         the scan grades PROSE the agent itself produced (transcripts, narrative
 *                          references). Under `--context pr` its failure is reported as an advisory
 *                          and does not fail the run; under `--context integration` it fails as ever.
 *
 * A changed path that matches NO scan's glob selects the FULL suite, and the runner says so. That is
 * the fail-closed direction: an unclassifiable change is one nobody has declared safe to skip over.
 */
/**
 * `dir/**` spelled without the two characters `/*` adjacent in this file's source. Not style:
 * `scan-guard-scope-fail-closed` reads this file as TEXT and strips block comments before it
 * parses the registry, so a literal `'.agents/**'` opened a comment that swallowed every
 * registration after it and reported the whole table as unregistered. Measured on this change.
 */
const under = (dir) => [dir, '**'].join('/');
/**
 * A harness HELPER a scan reads, spelled so the same text parser does not take it for a
 * registration: `registeredScanFiles` matches every literal `scripts/harness/<name>.mjs` in this
 * file and then classifies the finders it exports. Registered scans keep the literal form in
 * `command`; a helper named here as a subject is joined at runtime.
 */
const harnessFile = (name) => ['scripts/harness', `${name}.mjs`].join('/');
const AGENTS = under('.agents');
const RULES = under('.agents/rules');
const SKILLS = under('.agents/skills');
const SPECS = under('.agents/specs');
const SPEC_DOCS = under('.agents/spec-docs');
const TASKS = under('.agents/tasks');
const HARNESS_CONFIG = '.agents/harness.config.json';
const PACKAGES = under('packages');
const APPS = under('apps');
const EXAMPLES = under('examples');
/** The workspace as the scope enumerator sees it: the manifests plus every scope directory. */
const WORKSPACE = ['package.json', 'pnpm-workspace.yaml', PACKAGES, APPS, EXAMPLES];
const HARNESS = under('scripts/harness');
const SCRIPTS = under('scripts');
const GITHUB = under('.github');
const CLAUDE = under('.claude');
const HOOKS = under('.claude/hooks');
const AGENT_DEFS = under('.claude/agents');
const DOCS = under('docs');
const CONTENT = under('content');
const MARKDOWN = ['**', '*.md'].join('/');
const REGISTRY = 'scripts/harness/run-all-scans.mjs';

export const SCAN_COMMANDS = [
  {
    name: 'consistency',
    command: ['node', 'scripts/harness/scan-consistency.mjs'],
    examines: [AGENTS, 'AGENTS.md', 'CLAUDE.md', CLAUDE, ...WORKSPACE],
    cacheable: true,
  },
  {
    name: 'memory-mirror',
    command: ['node', 'scripts/harness/scan-memory-mirror.mjs'],
    examines: [under('.agents/memory')],
    cacheable: true,
  },
  {
    name: 'orchestration-map',
    command: ['node', 'scripts/harness/scan-orchestration-map.mjs'],
    examines: [AGENT_DEFS, SKILLS, '.agents/specs/orchestration-map.md'],
    cacheable: true,
  },
  {
    name: 'deployment-matrix',
    command: ['node', 'scripts/harness/scan-deployment-matrix.mjs'],
    examines: ['.agents/specs/deployment-matrix.md', PACKAGES],
    cacheable: true,
  },
  {
    name: 'orchestration-neutrality',
    command: ['node', 'scripts/harness/scan-orchestration-neutrality.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES],
  },
  {
    name: 'hook-catalog',
    command: ['node', 'scripts/harness/scan-hook-catalog.mjs'],
    examines: [PACKAGES, 'content/guide/permissions-and-hooks.md'],
  },
  {
    name: 'hook-enforcement-reachable',
    command: ['node', 'scripts/harness/scan-hook-enforcement-reachable.mjs'],
    examines: [GITHUB, PACKAGES, APPS, SCRIPTS],
  },
  {
    name: 'hook-registration',
    command: ['node', 'scripts/harness/scan-hook-registration.mjs'],
    examines: ['.claude/settings.json', HOOKS],
    cacheable: true,
  },
  {
    name: 'review-token-supply',
    command: ['node', 'scripts/harness/scan-review-token-supply.mjs'],
    examines: [GITHUB, CONTENT],
  },
  {
    name: 'claude-review-coverage',
    command: ['node', 'scripts/harness/scan-claude-review-coverage.mjs'],
    examines: [GITHUB],
  },
  {
    name: 'workflow-permissions',
    command: ['node', 'scripts/harness/scan-workflow-permissions.mjs'],
    examines: [GITHUB],
    cacheable: true,
  },
  {
    name: 'action-references',
    command: ['node', 'scripts/harness/scan-action-references.mjs'],
    examines: [GITHUB, REGISTRY],
  },
  {
    name: 'named-mechanism-resolves',
    command: ['node', 'scripts/harness/scan-named-mechanism-resolves.mjs'],
    examines: [RULES, 'AGENTS.md', SCRIPTS, 'package.json', CLAUDE],
    cacheable: true,
  },
  {
    name: 'hook-syntax',
    command: ['node', 'scripts/harness/scan-hook-syntax.mjs'],
    examines: [HOOKS],
    cacheable: true,
  },
  {
    name: 'skill-registration',
    command: ['node', 'scripts/harness/scan-skill-registration.mjs'],
    examines: [under('.claude/skills'), SKILLS, HOOKS, REGISTRY],
    cacheable: true,
  },
  {
    name: 'document-authority',
    command: ['node', 'scripts/harness/check-document-authority.mjs'],
    always: true,
  },
  {
    name: 'commands',
    command: ['node', 'scripts/harness/check-command-layering.mjs'],
    examines: [under('packages/agent-cli'), under('packages/agent-framework')],
    cacheable: true,
  },
  {
    name: 'capability-placement',
    command: ['node', 'scripts/harness/check-capability-placement.mjs'],
    examines: [
      '.agents/project-structure.md',
      HARNESS_CONFIG,
      PACKAGES,
      APPS,
      'package.json',
      DOCS,
    ],
  },
  {
    name: 'spec-manifest-restatement',
    command: ['node', 'scripts/harness/check-spec-manifest-restatement.mjs'],
    examines: [HARNESS_CONFIG, ...WORKSPACE],
  },
  {
    name: 'nested-package-glob-coverage',
    command: ['node', 'scripts/harness/check-nested-package-glob-coverage.mjs'],
    examines: ['pnpm-workspace.yaml', PACKAGES, '.agents/rules/learning-loop.md', GITHUB],
  },
  {
    name: 'background-workspace',
    command: ['node', 'scripts/harness/check-background-workspace-conformance.mjs'],
    examines: [PACKAGES, under('.agents/specs/architecture-map')],
  },
  {
    name: 'agent-server-boundary',
    command: ['node', 'scripts/harness/check-agent-server-boundary.mjs'],
    examines: [...WORKSPACE, under('.agents/specs/architecture-map')],
  },
  {
    name: 'sdk-public-surface',
    command: ['node', 'scripts/harness/check-sdk-public-surface.mjs'],
    examines: [PACKAGES, '.agents/project-structure.md', 'package.json'],
  },
  {
    name: 'specs',
    command: ['node', 'scripts/harness/audit-spec-coverage.mjs'],
    examines: [...WORKSPACE, DOCS, 'README.md'],
    cacheable: true,
  },
  {
    name: 'spec-paths',
    command: ['node', 'scripts/harness/check-spec-paths.mjs'],
    examines: [...WORKSPACE, DOCS],
    cacheable: true,
  },
  {
    name: 'arch-map-paths',
    command: ['node', 'scripts/harness/check-architecture-map-paths.mjs'],
    examines: [under('.agents/specs/architecture-map'), PACKAGES, APPS],
  },
  {
    name: 'arch-map-completeness',
    command: ['node', 'scripts/harness/check-architecture-map-completeness.mjs'],
    examines: [under('.agents/specs/architecture-map'), PACKAGES, 'README.md'],
  },
  {
    name: 'document-standards',
    command: ['node', 'scripts/harness/check-document-standards-index.mjs'],
    examines: [AGENTS],
  },
  {
    name: 'agent-def-convention',
    command: ['node', 'scripts/harness/check-agent-def-convention.mjs'],
    examines: [AGENT_DEFS, under('.agents/specs/document-standards'), SKILLS],
  },
  {
    name: 'fixture-floor',
    command: ['node', 'scripts/harness/check-fixture-floor.mjs'],
    examines: [HARNESS],
  },
  {
    name: 'contract-disposition',
    command: ['node', 'scripts/harness/check-contract-disposition.mjs'],
    examines: [under('.changeset'), 'README.md'],
  },
  {
    name: 'design-doc',
    command: ['node', 'scripts/harness/check-design-doc-completeness.mjs'],
    examines: [...WORKSPACE, SPECS, DOCS, REGISTRY],
  },
  {
    name: 'spec-whitebox-leakage',
    command: ['node', 'scripts/harness/check-spec-whitebox-leakage.mjs'],
    examines: [...WORKSPACE, SKILLS, DOCS, REGISTRY],
  },
  {
    name: 'adr',
    command: ['node', 'scripts/harness/check-adr-completeness.mjs'],
    examines: [under('.design')],
  },
  {
    name: 'spec-doc-frontmatter',
    command: ['node', 'scripts/harness/check-spec-doc-frontmatter.mjs'],
    examines: [SPEC_DOCS],
  },
  {
    name: 'spec-public-surface',
    command: ['node', 'scripts/harness/check-spec-public-surface.mjs'],
    examines: [...WORKSPACE, 'scripts/harness/spec-surface-baseline.json'],
  },
  {
    name: 'harness-config-paths',
    command: ['node', 'scripts/harness/check-harness-config-paths.mjs'],
    examines: [HARNESS, HARNESS_CONFIG, PACKAGES],
  },
  {
    name: 'workspace-refs',
    command: ['node', 'scripts/harness/check-workspace-refs.mjs'],
    examines: [
      ...WORKSPACE,
      SCRIPTS,
      MARKDOWN,
      '**/*.mmd',
      `**/*.{${SOURCE_EXTENSIONS.map((extension) => extension.slice(1)).join(',')}}`,
      '.changeset/pre.json',
    ],
  },
  // Package-name resolution belongs to workspace-refs. This guard owns the separate relation:
  // whether a resolved package declares the script selected by the command (issues #2660, #2796).
  {
    name: 'filter-script-resolves',
    command: ['node', 'scripts/harness/scan-filter-script-resolves.mjs'],
    examines: [MARKDOWN, ...WORKSPACE, SCRIPTS],
  },
  {
    name: 'ghost-package-refs',
    command: ['node', 'scripts/harness/check-ghost-package-refs.mjs'],
    examines: [PACKAGES, APPS, MARKDOWN, CLAUDE, SCRIPTS],
  },
  {
    name: 'stub-markers',
    command: ['node', 'scripts/harness/check-stub-markers.mjs'],
    examines: [...WORKSPACE],
  },
  {
    name: 'conflict-markers',
    command: ['node', 'scripts/harness/scan-conflict-markers.mjs'],
    examines: [AGENTS, 'AGENTS.md', PACKAGES, APPS, SCRIPTS],
    cacheable: true,
  },
  {
    name: 'reference-kind-qualified',
    command: ['node', 'scripts/harness/scan-reference-kind-qualified.mjs'],
    examines: [
      MARKDOWN,
      'scripts/harness/reference-kind-baseline.json',
      harnessFile('reference-kind'),
      harnessFile('enumerate-files'),
    ],
    advisory: true,
  },
  // INFRA-127. A rule catalogue's row IS the unit of obligation, so a row short of the columns its
  // header declares renders with rule text missing and nothing said. Six of 92 entries were in that
  // state when this landed.
  {
    name: 'rule-table-shape',
    command: ['node', 'scripts/harness/scan-rule-table-shape.mjs'],
    examines: [AGENTS],
    cacheable: true,
  },
  // INFRA-126. The suite exhausted /tmp's inodes and stopped every push from the host. `makeTemp()`
  // owns creation and teardown together; this refuses a direct call regardless of teardown, because
  // whether a directory is removed is not something a scan can see.
  {
    name: 'temp-dir-owner',
    command: ['node', 'scripts/harness/scan-temp-dir-owner.mjs'],
    examines: [under('scripts/harness/__tests__')],
    cacheable: true,
  },
  // INFRA-112. The accepted forms are derived from each hook's own source, so this compares the
  // declarations against the code rather than against a list that would drift beside them.
  {
    name: 'hook-override-declarations',
    command: ['node', 'scripts/harness/scan-hook-override-declarations.mjs'],
    examines: ['AGENTS.md', HOOKS, AGENTS],
  },
  {
    name: 'symlink-following-enumeration',
    command: ['node', 'scripts/harness/scan-symlink-following-enumeration.mjs'],
    examines: [SCRIPTS, CLAUDE, under('.husky')],
  },
  // #2222: a TUI render site reaches the terminal only through SafeText; raw ink Text imports refused.
  {
    name: 'tui-safe-text-boundary',
    command: ['node', 'scripts/harness/scan-tui-safe-text-boundary.mjs'],
    examines: [under('packages/agent-ui-terminal/src')],
  },
  // #2347 / #2051: provider normalization resolves the environment only through an injected resolver.
  {
    name: 'provider-env-resolution',
    command: ['node', 'scripts/harness/scan-provider-env-resolution.mjs'],
    examines: [
      'packages/agent-core/src/utils/env-ref.ts',
      'packages/agent-core/src/providers/provider-factory.ts',
      'packages/agent-executor/src/providers/provider-factory.ts',
    ],
  },
  // issue #1916. Reads only the tracked tree, so it is hermetic and a clone can judge it offline.
  {
    name: 'work-item-id-collision',
    command: ['node', 'scripts/harness/scan-work-item-id-collision.mjs'],
    examines: [TASKS, harnessFile('task-record-issue-link'), harnessFile('shared')],
  },
  // INFRA-102. Only the DECLARED edge runs here: it is hermetic. The `--measured` edge asks the
  // host toolchain what a workspace script actually runs on, which no manifest edit can make true
  // (Volta binds a package tool to its install-time Node), so it is a developer-run check.
  {
    name: 'node-version-single-valued',
    command: ['node', 'scripts/harness/scan-node-version-single-valued.mjs'],
    examines: ['package.json', 'pnpm-workspace.yaml', PACKAGES, APPS],
  },
  // #2163/#2155: every static DAG node registration identity has one declared package owner.
  {
    name: 'dag-node-registration-owner',
    command: ['node', 'scripts/harness/scan-dag-node-registration-owner.mjs'],
    examines: [under('packages/dag-nodes'), 'packages/dag-nodes/docs/SPEC.md'],
  },
  // RULE-018. GitHub applies a missing Issue Form label silently, while PR gates consume three
  // exact-name labels from the same repository namespace. The registry and fixed consumer baseline
  // make both relations fail closed without claiming to discover arbitrary label-shaped strings.
  {
    name: 'github-label-registry',
    command: ['node', 'scripts/harness/scan-github-label-registry.mjs'],
    examines: [
      '.github/labels.json',
      under('.github/ISSUE_TEMPLATE'),
      '.github/workflows/review-gate.yml',
      '.claude/hooks/merge-gate.sh',
      harnessFile('record-local-review'),
      harnessFile('scan-github-label-registry'),
    ],
  },
  // D1. operational.md requires the three routing documents to stay lean; nothing else in the scan
  // suite covers markdown against a line-count ceiling. The ratchet enforces the direction; the gap
  // to the 80-line target is reported every run.
  {
    name: 'routing-document-size',
    command: ['node', 'scripts/harness/scan-routing-document-size.mjs'],
    examines: ['AGENTS.md', RULES, '.agents/project-structure.md'],
  },
  {
    name: 'shell-portability',
    command: ['node', 'scripts/harness/scan-shell-portability.mjs'],
    examines: ['.agents/rules/operational.md', SCRIPTS, under('.husky'), HOOKS],
  },
  {
    name: 'ci-base-history',
    command: ['node', 'scripts/harness/scan-ci-base-history.mjs'],
    // The workflows, plus the base-history scripts the scan declares by name.
    examines: [
      GITHUB,
      harnessFile('check-regression-red-proof'),
      'scripts/harness/check-document-authority.mjs',
      'scripts/harness/scan-promotion-ancestry.mjs',
    ],
  },
  {
    name: 'automerge-disarm-permission',
    command: ['node', 'scripts/harness/scan-automerge-disarm-permission.mjs'],
    examines: [GITHUB],
  },
  {
    name: 'main-required-checks',
    command: ['node', 'scripts/harness/scan-main-required-checks.mjs'],
    examines: [GITHUB],
  },
  // INFRA-097. A required check triggered by `pull_request` loads its YAML from the PR, so the
  // change carries the control plane that judges it. This makes such an edit visible; it does not
  // make the control plane trusted — that needs configuration outside this repository.
  {
    name: 'workflow-provenance',
    command: ['node', 'scripts/harness/scan-workflow-provenance.mjs'],
    examines: [GITHUB],
  },
  // Issue #2039. The sibling above makes a `pull_request` gate's edit VISIBLE; a `pull_request_target`
  // gate fails the opposite way — it loads its YAML from the default branch, so a fix to it is inert
  // on the branch that carries it and stays inert until promotion. This reports that gap.
  {
    name: 'pull-request-target-promotion-lag',
    command: ['node', 'scripts/harness/scan-pull-request-target-promotion-lag.mjs'],
    examines: [GITHUB],
  },
  {
    name: 'new-rule-declares-enforcement',
    command: ['node', 'scripts/harness/scan-new-rule-declares-enforcement.mjs'],
    examines: [RULES, harnessFile('shared')],
  },
  {
    name: 'named-artifact-resolves',
    command: ['node', 'scripts/harness/scan-named-artifact-resolves.mjs'],
    always: true,
  },
  {
    name: 'required-check-local-reachability',
    command: ['node', 'scripts/harness/scan-required-check-local-reachability.mjs'],
    examines: ['package.json', '.github/required-status-checks.json'],
  },
  {
    name: 'required-check-needs',
    command: ['node', 'scripts/harness/scan-required-check-needs.mjs'],
    examines: [GITHUB],
  },
  {
    name: 'test-selection-tolerance',
    command: ['node', 'scripts/harness/scan-test-selection-tolerance.mjs'],
    examines: [GITHUB, PACKAGES, APPS, 'package.json'],
  },
  {
    // INFRA-063 D7 — `pnpm test` is `-r --if-present test`, which walks past every suite declared
    // under any other name. The release gate ran one of them (`test:bin`) only because someone had
    // written it in by hand, and never saw `agent-cli-web`'s `test:e2e` at all. Enumerates every
    // `^test(:|$)` script and requires each to be run or excluded with a re-verified reason.
    name: 'release-sweep-coverage',
    command: ['node', 'scripts/harness/scan-release-sweep-coverage.mjs'],
    examines: [...WORKSPACE, GITHUB, harnessFile('release-test-suites')],
  },
  {
    // INFRA-060 D4 — the affected-scope calculator resolved build tooling to ZERO scopes, so a PR
    // changing how every package is built left the REQUIRED `build` and `quality` checks green
    // having verified nothing. Executes the calculator against each declared path.
    name: 'build-tooling-scope',
    command: ['node', 'scripts/harness/scan-build-tooling-scope.mjs'],
    // The calculator, the declared tooling paths (the root-level scripts), and every input the
    // calculator resolves a scope from.
    examines: [
      harnessFile('check-plan'),
      harnessFile('shared'),
      ['scripts', '*.mjs'].join('/'),
      ...WORKSPACE,
      'tsconfig*.json',
      '.eslintrc.json',
      'pnpm-lock.yaml',
      'vitest*.ts',
    ],
  },
  {
    name: 'no-fallback',
    command: ['node', 'scripts/harness/scan-no-fallback.mjs'],
    examines: [...WORKSPACE],
  },
  // CORE-030: a produced tool with no declared permission profile takes the fail-safe fallback,
  // which prompts on every call and is refused in plan mode. Silent, and it had already happened.
  {
    name: 'tool-classification',
    command: ['node', 'scripts/harness/scan-tool-classification.mjs'],
    examines: [...WORKSPACE],
  },
  {
    name: 'transport-admission',
    command: ['node', 'scripts/harness/scan-transport-admission.mjs'],
    examines: [PACKAGES, HARNESS_CONFIG],
  },
  {
    name: 'transport-conformance',
    command: ['node', 'scripts/harness/scan-transport-conformance.mjs'],
    examines: [
      PACKAGES,
      HARNESS_CONFIG,
      'scripts/harness/transport-conformance.tsconfig.json',
      'package.json',
    ],
  },
  {
    name: 'browser-package-node-subpath',
    command: ['node', 'scripts/harness/scan-browser-package-node-subpath.mjs'],
    examines: [...WORKSPACE, HARNESS_CONFIG],
  },
  {
    name: 'authority-bypass',
    command: ['node', 'scripts/harness/scan-authority-bypass.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES, APPS],
  },
  {
    // ARCH-042: public project APIs consume opaque authority/facets; removed cwd helpers and
    // ambient fallbacks must not re-enter through an initial/stateless consumer.
    name: 'public-project-authority',
    command: ['node', 'scripts/harness/scan-public-project-authority.mjs'],
    examines: [PACKAGES],
  },
  {
    name: 'run-advancement-owner',
    command: ['node', 'scripts/harness/scan-run-advancement-owner.mjs'],
    examines: [PACKAGES, APPS],
  },
  {
    name: 'contract-cast-ratchet',
    command: ['node', 'scripts/harness/scan-contract-cast-ratchet.mjs'],
    examines: [
      HARNESS_CONFIG,
      'scripts/harness/contract-cast-baseline.json',
      PACKAGES,
      APPS,
      SCRIPTS,
    ],
  },
  {
    // ARCH-029: the load-bearing floor. Decomposing a god contract does not fix it — consumers
    // must stop NAMING it, and REFACTOR-006 proved those are different events on this very
    // contract.
    //
    // The scan guards THREE aggregates and each has its own frozen count, in
    // scripts/harness/aggregate-naming-baseline.json. Only `ICommandHostContext` — the god contract
    // TC-05 drove to zero — is at 0; `IAgentJobHostContext` and `ICommandSessionRuntime` are frozen
    // above zero and burn down from there. This used to read "Frozen at 0" with no subject, which a
    // reader would take as covering all three.
    name: 'aggregate-naming',
    command: ['node', 'scripts/harness/scan-aggregate-naming.mjs'],
    examines: [
      'scripts/harness/aggregate-naming-baseline.json',
      HARNESS_CONFIG,
      CONTENT,
      PACKAGES,
      APPS,
    ],
  },
  {
    // ARCH-029 TC-06: role ports carry no optional members. An aggregate-level optional CEILING
    // would not have caught the regression this guards, which is why the rule is per-port.
    name: 'role-port-optionals',
    command: ['node', 'scripts/harness/scan-role-port-optionals.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES, CONTENT],
  },
  {
    // ARCH-037: a barrel-exported function's parameter types must be exported from the same barrel.
    // A published function whose argument cannot be named is one the consumer reverse-engineers or
    // casts into. ARCH-025 fixed that shape once and it recurred, which is why it is a floor.
    name: 'barrel-parameter-types',
    command: ['node', 'scripts/harness/scan-barrel-parameter-types.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES],
  },
  {
    // ARCH-013 stage 2: a resolved-preset field must reach a declared projection surface, and the
    // startup and live-/preset surfaces must agree. Stage 1's scan-option-reachability covers the
    // LAST hop of the same chain (a declared session option nothing assigns); this covers the FIRST.
    // The divergence half is the `effort` class: a field one path applies and the other drops means
    // one session holds two answers for the same preset depending on when it was chosen.
    name: 'preset-projection',
    command: ['node', 'scripts/harness/scan-preset-projection.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES, APPS, CONTENT],
  },
  {
    name: 'literal-cast-union',
    command: ['node', 'scripts/harness/scan-literal-cast-union.mjs'],
    examines: [PACKAGES, APPS, SCRIPTS],
  },
  {
    name: 'option-reachability',
    command: ['node', 'scripts/harness/scan-option-reachability.mjs'],
    examines: [HARNESS_CONFIG, 'scripts/harness/option-reachability-baseline.json', PACKAGES, APPS],
  },
  {
    // #2726: each declared TUI, print/goal and serve capability must cross its session path.
    name: 'session-capability-projections',
    command: ['node', 'scripts/harness/scan-session-capability-projections.mjs'],
    examines: [PACKAGES, 'scripts/harness/scan-session-capability-projections.mjs'],
  },
  {
    name: 'publish-registry',
    command: ['node', 'scripts/harness/scan-publish-registry.mjs'],
    examines: ['.agents/publish-registry.md', '.agents/project-structure.md', ...WORKSPACE],
  },
  {
    name: 'product-identity',
    command: ['node', 'scripts/harness/scan-product-identity.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES, 'scripts/harness/product-identity-baseline.json'],
  },
  {
    name: 'harness-script-import-safety',
    command: ['node', 'scripts/harness/scan-harness-script-import-safety.mjs'],
    examines: [HARNESS],
  },
  // INFRA-039. The CEILING, not the count: `--max-warnings` on the root `lint` script does the
  // enforcing, on the release path where that script already runs. This keeps the number from
  // becoming a hand-maintained second source — present, matching its baseline, and falling only.
  {
    name: 'lint-ceiling-declared-vs-frozen',
    command: ['node', 'scripts/harness/scan-lint-ceiling-declared-vs-frozen.mjs'],
    examines: ['scripts/harness/lint-warning-baseline.json', 'package.json'],
  },
  {
    name: 'ci-concurrency-footprint',
    command: ['node', 'scripts/harness/scan-ci-concurrency-footprint.mjs'],
    examines: [GITHUB, 'scripts/harness/ci-footprint-baseline.json'],
  },
  {
    name: 'runner-wait',
    command: ['node', 'scripts/harness/scan-runner-wait.mjs'],
    examines: [GITHUB],
  },
  {
    name: 'rule-case-narrative',
    command: ['node', 'scripts/harness/scan-rule-case-narrative.mjs'],
    examines: [RULES, 'scripts/harness/rule-case-narrative-baseline.json'],
  },
  {
    // HARNESS-2485 — compare explicit normative claims across distinct rule documents.
    name: 'rule-contradictions',
    command: ['node', 'scripts/harness/scan-rule-contradictions.mjs'],
    examines: [RULES],
  },
  {
    name: 'retired-agent-references',
    command: ['node', 'scripts/harness/scan-retired-agent-references.mjs'],
    examines: [CLAUDE, AGENTS, HARNESS],
  },
  {
    name: 'resolving-claims',
    command: ['node', 'scripts/harness/scan-resolving-claims.mjs'],
    examines: [AGENTS, PACKAGES],
  },
  {
    // CORE-046: the remote streaming route's spelling, compared across two packages that must not
    // import each other. No single test can hold both values, which is why the disagreement
    // survived long enough to make every remote streaming call a 404.
    name: 'remote-stream-route-spelling',
    command: ['node', 'scripts/harness/scan-remote-stream-route-spelling.mjs'],
    examines: [under('apps/agent-server'), under('packages/agent-remote-client')],
  },
  {
    name: 'mistake-mechanisms',
    command: ['node', 'scripts/harness/scan-mistake-mechanisms.mjs'],
    examines: [RULES, 'eslint.config.*', '.eslintrc.*', GITHUB, REGISTRY, CLAUDE],
  },
  {
    name: 'harness-scope-literal',
    command: ['node', 'scripts/harness/scan-harness-scope-literal.mjs'],
    examines: [HARNESS_CONFIG, HARNESS, ...WORKSPACE],
  },
  {
    name: 'release-verification-gate',
    command: ['node', 'scripts/harness/scan-release-verification-gate.mjs'],
    examines: [
      'scripts/harness/verify-macos-release-artifacts.sh',
      GITHUB,
      under('apps/agent-app'),
    ],
  },
  {
    name: 'legacy-typescript',
    command: ['node', 'scripts/harness/scan-legacy-typescript.mjs'],
    examines: [HARNESS, ...WORKSPACE, 'scripts/harness/legacy-typescript-baseline.json'],
  },
  {
    name: 'no-fake-in-src',
    command: ['node', 'scripts/harness/scan-no-fake-in-src.mjs'],
    examines: [...WORKSPACE],
  },
  {
    name: 'measurement-provenance',
    command: ['node', 'scripts/harness/scan-measurement-provenance.mjs'],
    examines: [SCRIPTS, 'vitest.config.ts'],
  },
  {
    name: 'helper-limits',
    command: ['node', 'scripts/harness/scan-helper-limits.mjs'],
    examines: [HARNESS],
  },
  {
    // HARNESS-052 — the audited "success over work it did not do" shape wearing a test: an
    // assertion that no implementation of the code under test could fail.
    name: 'tautological-assertions',
    command: ['node', 'scripts/harness/scan-tautological-assertions.mjs'],
    examines: [PACKAGES, APPS, SCRIPTS],
  },
  {
    // HARNESS-052 — and the same shape wearing a GUARD: a scan whose governed tree is absent and
    // which reports a pass rather than an error.
    name: 'guard-scope-fail-closed',
    command: ['node', 'scripts/harness/scan-guard-scope-fail-closed.mjs'],
    examines: [HARNESS],
  },
  {
    name: 'api-pagination',
    command: ['node', 'scripts/harness/scan-api-pagination.mjs'],
    examines: [SCRIPTS, GITHUB, PACKAGES],
  },
  {
    name: 'live-smoke-provider-coverage',
    command: ['node', 'scripts/harness/scan-live-smoke-provider-coverage.mjs'],
    examines: [
      harnessFile('live-provider-smoke'),
      PACKAGES,
      '.github/workflows/live-provider-smoke.yml',
    ],
  },
  {
    name: 'composition-neutrality',
    command: ['node', 'scripts/harness/scan-composition-neutrality.mjs'],
    examines: [HARNESS_CONFIG, ...WORKSPACE],
  },
  {
    name: 'session-artifact-neutrality',
    command: ['node', 'scripts/harness/scan-session-artifact-neutrality.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES],
  },
  {
    name: 'agent-tools-neutrality',
    command: ['node', 'scripts/harness/scan-agent-tools-neutrality.mjs'],
    examines: [under('packages/agent-tools'), HARNESS_CONFIG],
  },
  {
    name: 'memory-neutrality',
    command: ['node', 'scripts/harness/scan-memory-neutrality.mjs'],
    examines: [HARNESS_CONFIG, ...WORKSPACE],
  },
  {
    name: 'evals-neutrality',
    command: ['node', 'scripts/harness/scan-evals-neutrality.mjs'],
    examines: [HARNESS_CONFIG, PACKAGES, EXAMPLES],
  },
  {
    name: 'prompt-prose',
    command: ['node', 'scripts/harness/scan-prompt-prose.mjs'],
    examines: [HARNESS_CONFIG, ...WORKSPACE],
  },
  {
    name: 'capability-reachability',
    command: ['node', 'scripts/harness/scan-capability-reachability.mjs'],
    examines: [AGENTS],
  },
  {
    name: 'progress-report-quantification',
    command: ['node', 'scripts/harness/scan-progress-report-quantification.mjs'],
    always: true,
    advisory: true,
    contexts: ['integration'],
    localOnly: true,
  },
  {
    name: 'deprecated-markers',
    command: ['node', 'scripts/harness/scan-deprecated-markers.mjs'],
    examines: [...WORKSPACE],
  },
  {
    name: 'test-module-mocks',
    command: ['node', 'scripts/harness/check-test-module-mocks.mjs'],
    examines: [HARNESS_CONFIG, ...WORKSPACE, TASKS],
  },
  {
    name: 'doc-examples',
    command: ['node', 'scripts/harness/check-doc-examples.mjs'],
    examines: [...WORKSPACE, CONTENT, 'README.md', 'tsconfig.json'],
  },
  {
    name: 'llms-txt',
    command: ['node', 'scripts/harness/check-llms-txt.mjs'],
    examines: ['llms.txt', MARKDOWN, CONTENT, DOCS],
  },
  {
    name: 'temp-script-placement',
    command: ['node', 'scripts/harness/check-temp-script-placement.mjs'],
    examines: [PACKAGES, APPS],
  },
  {
    name: 'orphan-exports',
    command: ['node', 'scripts/harness/check-orphan-exports.mjs'],
    examines: [...WORKSPACE, '.agents/project-structure.md', SCRIPTS],
  },
  {
    name: 'deps',
    command: ['node', 'scripts/harness/check-dependency-direction.mjs'],
    examines: [...WORKSPACE, HARNESS_CONFIG, '.agents/specs/contract-family-owner-map.md'],
  },
  {
    name: 'dep-kind',
    command: ['node', 'scripts/harness/check-dep-kind.mjs'],
    examines: [...WORKSPACE],
  },
  {
    name: 'interface-imports',
    command: ['node', 'scripts/harness/check-interface-imports.mjs'],
    examines: [...WORKSPACE],
  },
  {
    // Issue #2230 — every source file's workspace imports (tests included) against the importer's
    // declared dependencies and the named package's real exports; the gap between `deps` and
    // `interface-imports`.
    name: 'workspace-import-integrity',
    command: ['node', 'scripts/harness/scan-workspace-import-integrity.mjs'],
    examines: [...WORKSPACE],
  },
  {
    name: 'interface-runtime',
    command: ['node', 'scripts/harness/scan-interface-runtime.mjs'],
    examines: [
      '.agents/project-structure.md',
      PACKAGES,
      'scripts/harness/interface-entry-baseline.json',
    ],
  },
  {
    // ARCH-100 (issue #2080): the contract-family owner map in
    // `.agents/project-structure.md` is the SSOT; this scan parses it and refuses an
    // unassigned/doubly-assigned family, a cyclic projected package graph, or a module
    // sitting outside an owner package that already exists.
    name: 'interface-family-owner',
    command: ['node', 'scripts/harness/scan-interface-family-owner.mjs'],
    examines: [
      '.agents/specs/contract-family-owner-map.md',
      '.agents/project-structure.md',
      PACKAGES,
      HARNESS_CONFIG,
      'package.json',
    ],
  },
  {
    // HARNESS-117 (issue #2178): a rule that is ENFORCED still has a STATEMENT somebody can read.
    // Binds the rule IDENTIFIER a scan emits, not the scan file — a file implements many rules, so
    // one rule's statement can vanish while the file is still named for another.
    name: 'rule-statement-floor',
    command: ['node', 'scripts/harness/scan-rule-statement-floor.mjs'],
    examines: [AGENTS, 'AGENTS.md', 'ARCHITECTURE.md', 'CLAUDE.md', DOCS, HARNESS],
  },
  {
    // ARCH-021: the same family as interface-runtime — "package X's src/ must not import Y". This one
    // holds the TOOL axis, which the manifest edge cannot cut (ARCH-035 / #1787).
    name: 'subagent-runner-composition',
    command: ['node', 'scripts/harness/scan-subagent-runner-composition.mjs'],
    examines: [under('packages/agent-subagent-runner'), HARNESS_CONFIG, 'package.json'],
  },
  {
    name: 'publish',
    command: ['node', 'scripts/harness/check-publish-safety.mjs'],
    examines: [...WORKSPACE, DOCS, 'scripts/check-pnpm-publish.sh'],
  },
  {
    name: 'release-governance',
    command: ['node', 'scripts/harness/check-release-governance.mjs'],
    examines: [
      'package.json',
      RULES,
      GITHUB,
      under('scripts/publish'),
      REGISTRY,
      harnessFile('release-run'),
      under('.agents/release-runs'),
      under('.agents/templates'),
    ],
  },
  {
    name: 'test-plans',
    command: ['node', 'scripts/harness/scan-test-plan.mjs'],
    examines: [AGENTS, DOCS, REGISTRY],
  },
  {
    name: 'functional-coverage',
    command: ['node', 'scripts/harness/check-functional-coverage.mjs'],
    examines: ['scripts/harness/functional-coverage-manifest.json', PACKAGES, APPS],
  },
  {
    name: 'coverage-scripts',
    command: ['node', 'scripts/harness/check-test-coverage-scripts.mjs'],
    examines: [...WORKSPACE, REGISTRY, 'scripts/harness/check-test-coverage-scripts.mjs'],
  },
  {
    name: 'build-contracts',
    command: ['node', 'scripts/harness/check-build-output-contracts.mjs'],
    // Reads build OUTPUT, which no tree hash speaks for (`TREE_EXTERNAL_SCANS`), but the output is
    // a function of the package sources and their build configuration — those are its subject.
    examines: [...WORKSPACE, 'tsconfig*.json'],
  },
  {
    name: 'dist',
    command: ['node', 'scripts/harness/scan-dist-freshness.mjs'],
    // Freshness is dist against each package's sources; a change outside the workspace cannot
    // stale it.
    examines: [...WORKSPACE, 'tsconfig*.json'],
  },
  {
    name: 'vitest-resource-ceiling',
    command: ['node', 'scripts/harness/scan-vitest-resource-ceiling.mjs'],
    examines: ['vitest.shared.ts', 'vitest.config.*', PACKAGES, APPS, 'pnpm-workspace.yaml'],
  },
  {
    name: 'docs-structure',
    command: ['pnpm', 'docs:validate-structure'],
    examines: [under('scripts/docs'), PACKAGES],
  },
  {
    name: 'package-boundary-ownership',
    command: ['node', 'scripts/harness/scan-package-boundary-ownership.mjs'],
    examines: [
      '.agents/package-boundaries.json',
      'package.json',
      'pnpm-workspace.yaml',
      PACKAGES,
      APPS,
      harnessFile('workspace-graph'),
      harnessFile('workspace-source-inventory'),
      harnessFile('workspace-source-reference-extraction'),
      harnessFile('workspace-source-reference-resolution'),
      harnessFile('workspace-source-config-resolution'),
    ],
  },
  {
    name: 'ssot-five-axis',
    command: ['node', 'scripts/harness/scan-ssot-five-axis.mjs'],
    examines: [PACKAGES, harnessFile('scan-ssot-five-axis')],
  },
];

/** The lanes a run can declare with `--context`; the default is the stricter one. */
export const SCAN_CONTEXTS = ['pr', 'integration'];

/** Names of the registered scans whose failure is advisory under `--context pr`. */
export function advisoryScanNames(scans = SCAN_COMMANDS) {
  return new Set(scans.filter((scan) => scan.advisory === true).map((scan) => scan.name));
}

/** Remove route-inapplicable scans before affected-path selection; N/A work is not a green check. */
export function selectScansForExecutionContext(scans, { context, environment = process.env } = {}) {
  if (!SCAN_CONTEXTS.includes(context)) {
    throw new Error(
      `run-all-scans: unknown context \`${context}\` (expected ${SCAN_CONTEXTS.join('|')})`,
    );
  }
  return scans.filter(
    (scan) =>
      (!Array.isArray(scan.contexts) || scan.contexts.includes(context)) &&
      !(scan.localOnly === true && environment.CI),
  );
}

/**
 * Recompute and publish the hook migration inventory outside SCAN_COMMANDS.
 *
 * This producer is deliberately independent of a scan receipt: it runs for a
 * full scan and a reused receipt, while only ordinary scan diagnostics remain
 * eligible for receipt persistence.
 */
export async function publishHookDiagnosticInventory({
  root = WORKSPACE_ROOT,
  scanNames,
  correlationId,
  write = (line) => process.stdout.write(`${line}\n`),
  produce = collectHookDiagnosticInventoryResults,
  deliver = deliverHookDiagnosticReport,
}) {
  const results = produce({ root, scanNames, correlationId });
  return deliver({
    results,
    correlationId,
    publish: ({ json, text }) => {
      write('Hook diagnostic migration report JSON:');
      for (const line of json.trimEnd().split('\n')) write(line);
      write('');
      for (const line of text.trimEnd().split('\n')) write(line);
      write('');
    },
  });
}

/**
 * A workspace glob as a RegExp over a repository-relative path. `**` spans directories, `*` and `?`
 * stay inside one segment, `{a,b}` alternates. Anchored: `package.json` is the ROOT manifest, not
 * every manifest — a scan that reads every one says `packages/**` beside it.
 */
export function globToRegExp(glob) {
  let source = '';
  const pattern = String(glob).replace(/^\.\//, '');
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` may match nothing at all; a bare `**` swallows the rest.
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') source += '[^/]';
    else if (char === '{') source += '(?:';
    else if (char === '}') source += ')';
    else if (char === ',') source += '|';
    else source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Whether a repository-relative path is inside any of the globs. A trailing `/` (an untracked directory) is kept: `dir/` is read as everything under it. */
export function pathMatchesAny(file, globs) {
  const normalized = String(file).trim().replaceAll('\\', '/').replace(/^\.\//, '');
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

function relativeImportSpecifiers(source) {
  const uncommented = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1');
  const pattern =
    /(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|import\s*['"](\.[^'"]+)['"]/gu;
  const specifiers = [];
  let match;
  while ((match = pattern.exec(uncommented)) !== null) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

function repositoryRelativePath(root, absolute) {
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  return relative === '' || relative.startsWith('../') || path.isAbsolute(relative)
    ? null
    : relative;
}

function localImportResolution(root, importer, specifier) {
  const raw = path.resolve(path.dirname(path.join(root, importer)), specifier);
  const candidates = path.extname(raw)
    ? [raw]
    : [
        raw,
        `${raw}.mjs`,
        `${raw}.js`,
        `${raw}.cjs`,
        `${raw}.json`,
        path.join(raw, 'index.mjs'),
        path.join(raw, 'index.js'),
      ];
  const withinRepository = candidates
    .map((candidate) => ({
      absolute: candidate,
      relative: repositoryRelativePath(root, candidate),
    }))
    .filter((candidate) => candidate.relative !== null);
  const resolved = withinRepository.find(({ absolute }) => {
    try {
      return existsSync(absolute) && statSync(absolute).isFile();
    } catch {
      return false;
    }
  });
  return resolved ? [resolved] : withinRepository;
}

const scanCommandClosureCache = new WeakMap();

function scanCommandEntrypoints(scan, root) {
  if (
    scan.command?.[0] === 'node' &&
    typeof scan.command[1] === 'string' &&
    !path.isAbsolute(scan.command[1])
  ) {
    return [scan.command[1].replaceAll('\\', '/')];
  }
  if (scan.command?.[0] !== 'pnpm' || typeof scan.command[1] !== 'string') return [];
  const manifest = 'package.json';
  try {
    const scripts = JSON.parse(readFileSync(path.join(root, manifest), 'utf8')).scripts ?? {};
    const script = scripts[scan.command[1]];
    const entrypoint =
      typeof script === 'string'
        ? /^\s*node\s+(?:--\S+\s+)*(["']?)([^\s"']+)\1(?:\s|$)/u.exec(script)?.[2]
        : undefined;
    return entrypoint && !path.isAbsolute(entrypoint)
      ? [manifest, entrypoint.replaceAll('\\', '/')]
      : [manifest];
  } catch {
    return [manifest];
  }
}

/** Every repository-local module a Node scan can reach through literal import/export edges. */
export function scanCommandImportClosure(scan, root = WORKSPACE_ROOT) {
  const normalizedRoot = path.resolve(root);
  const cachedByRoot = scanCommandClosureCache.get(scan);
  if (cachedByRoot?.has(normalizedRoot)) return [...cachedByRoot.get(normalizedRoot)];
  const entrypoints = scanCommandEntrypoints(scan, normalizedRoot);
  if (entrypoints.length === 0) return [];

  const closure = new Set(entrypoints);
  const pending = [...entrypoints];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    let source;
    try {
      source = readFileSync(path.join(normalizedRoot, current), 'utf8');
    } catch {
      continue;
    }
    for (const specifier of relativeImportSpecifiers(source)) {
      for (const resolved of localImportResolution(normalizedRoot, current, specifier)) {
        closure.add(resolved.relative);
        if (existsSync(resolved.absolute) && !visited.has(resolved.relative)) {
          pending.push(resolved.relative);
        }
      }
    }
  }
  const result = [...closure].sort();
  const nextCache = cachedByRoot ?? new Map();
  nextCache.set(normalizedRoot, result);
  scanCommandClosureCache.set(scan, nextCache);
  return [...result];
}

/** A scan's implementation closure is always input, even when its subject is elsewhere. */
export function scanInputGlobs(scan, root = WORKSPACE_ROOT) {
  const declared = Array.isArray(scan.examines) ? scan.examines : [];
  return [...new Set([...declared, ...scanCommandImportClosure(scan, root)])];
}

/** Resolve each scan's declared repository inputs once for content-addressed success caching. */
export function scanSuccessInputs(scans, repositoryFiles, root = WORKSPACE_ROOT) {
  return new Map(
    scans.map((scan) => {
      const patterns = scanInputGlobs(scan, root);
      return [
        scan.name,
        {
          patterns,
          files: repositoryFiles.filter((file) => pathMatchesAny(file, patterns)),
        },
      ];
    }),
  );
}

/**
 * Select the scans a set of changed paths can reach.
 *
 * Pure over the registry and the paths, so it is tested with a fixture list and never by spawning.
 * Returns `{ selected, excluded, full, reason, unmatched }`:
 *   - every `always` scan is selected on any change;
 *   - a scan with `examines` is selected when any changed path is inside any of its globs;
 *   - a changed path inside NO declared glob (the `always` scans declare none) selects the FULL
 *     registry — `full: true`, `reason` names the path — because nobody has said a scan can skip it;
 *   - a scan that declares neither is a REGISTRATION DEFECT and throws: a scan that cannot say what
 *     it reads would otherwise be silently skipped on every affected run.
 */
export function selectAffectedScans(scans, changedPaths) {
  const changed = [...new Set((changedPaths ?? []).map((p) => String(p).trim()).filter(Boolean))];
  for (const scan of scans) {
    if (scan.always !== true && !Array.isArray(scan.examines)) {
      throw new Error(
        `run-all-scans: \`${scan.name}\` declares neither \`examines\` nor \`always\`, so ` +
          '--affected cannot tell whether a change reaches it. Declare what it reads (PROC-016).',
      );
    }
  }
  if (changed.length === 0) {
    return {
      selected: scans,
      excluded: [],
      full: true,
      unmatched: [],
      reason: 'no changed paths were resolved — selecting the full suite (fail closed)',
    };
  }
  const globsByScan = new Map(scans.map((scan) => [scan, scanInputGlobs(scan)]));
  const declared = scans.filter((scan) => globsByScan.get(scan).length > 0);
  const unmatched = changed.filter(
    (file) => !declared.some((scan) => pathMatchesAny(file, globsByScan.get(scan))),
  );
  if (unmatched.length > 0) {
    return {
      selected: scans,
      excluded: [],
      full: true,
      unmatched,
      reason:
        `changed path${unmatched.length === 1 ? '' : 's'} ${unmatched.map((f) => `\`${f}\``).join(', ')} ` +
        `${unmatched.length === 1 ? 'matches' : 'match'} no scan's declared globs — selecting the full suite (fail closed)`,
    };
  }
  const selected = scans.filter(
    (scan) =>
      scan.always === true || changed.some((file) => pathMatchesAny(file, globsByScan.get(scan))),
  );
  const chosen = new Set(selected.map((scan) => scan.name));
  return {
    selected,
    excluded: scans.filter((scan) => !chosen.has(scan.name)),
    full: false,
    unmatched: [],
    reason: null,
  };
}

/** One line a reader can compare against the summary: what was selected and what was left out. */
export function describeAffectedSelection(selection) {
  const names = selection.excluded.map((scan) => scan.name);
  const tail = names.length > 0 ? ` (${names.join(', ')})` : '';
  return `affected: ${selection.selected.length} selected, ${selection.excluded.length} excluded${tail}`;
}

function gitLines(args, root) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${(result.stderr ?? '').trim() || '(no stderr)'}`,
    );
  }
  return result.stdout.split('\n').map((line) => line.replace(/\r$/, ''));
}

/** Paths `git status --porcelain` reports, retaining both sides if a rename is ever emitted. */
export function parseStatusPorcelain(output) {
  const files = [];
  for (const line of String(output ?? '').split('\n')) {
    if (line.length < 4) continue;
    const entry = line.slice(3);
    const arrow = entry.indexOf(' -> ');
    if (arrow === -1) files.push(entry);
    else files.push(entry.slice(0, arrow), entry.slice(arrow + 4));
  }
  return files;
}
/**
 * The changed paths of this checkout against a base: the committed delta (union across every merge
 * base, as `classify-changed-paths.mjs` computes it) plus whatever the working tree holds that the
 * index does not. Returns `{ files, base, error }`; an error is a reason to run the full suite, never
 * a reason to run less.
 */
export function resolveChangedPaths({
  explicitBase = null,
  root = WORKSPACE_ROOT,
  env = process.env,
} = {}) {
  const refExists = (ref) =>
    spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    }).status === 0;
  const base = resolveBaseRef({ explicitBaseRef: explicitBase, env, refExists });
  if (!base) {
    return {
      files: [],
      base: null,
      error: explicitBase
        ? `base ref \`${explicitBase}\` does not resolve`
        : 'no base ref resolves (set HARNESS_BASE_REF, pass --base, or fetch origin/develop)',
    };
  }
  const range = classifyRange({ baseRef: base, head: 'HEAD', cwd: root });
  if (range.error) return { files: [], base, error: range.error };
  let working;
  try {
    working = parseStatusPorcelain(
      gitLines(['status', '--porcelain', '--no-renames'], root).join('\n'),
    );
  } catch (error) {
    return { files: [], base, error: error?.message ?? String(error) };
  }
  return { files: [...new Set([...range.files, ...working])].sort(), base, error: null };
}
function spawnScan(command) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: WORKSPACE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
    child.on('error', (err) => resolve({ code: 1, output: `${output}${err?.message ?? err}\n` }));
  });
}

function defaultPublicationUnavailableNotice(result) {
  process.stderr.write(
    `Diagnostic publication unavailable [${result.id}] ${result.publication.target}: ` +
      `${result.publication.detail}\n`,
  );
}

function shellQuote(argument) {
  const value = String(argument);
  return /^[A-Za-z0-9_./:=@+-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function reproductionCommand(scan) {
  return Array.isArray(scan.command) ? scan.command.map(shellQuote).join(' ') : null;
}

/**
 * Run scans with BOUNDED CONCURRENCY (INFRA-037), never early-exiting, then emit a final summary.
 * Each scan is `{ name, command?, run: () => Promise<{code, output}> | Promise<number> }`. Output is
 * captured per scan and a failure plus its exact command is printed as soon as that scan completes;
 * passing output stays suppressed.
 * Returns the aggregate exit code (0 = all passed). The summary + exit code are order-independent.
 *
 * THREE output channels, not two (HARNESS-053): failures print in full, `ADVISORY_MARKER` lines
 * print from every scan regardless of verdict, and everything else from a passing scan stays
 * suppressed. Advisories never touch the return value — `runScans` returns 0 for a suite whose only
 * findings are advisory, and that is pinned by a test.
 */
export async function runScans(
  scans,
  write = (line) => process.stdout.write(`${line}\n`),
  concurrency = DEFAULT_SCAN_CONCURRENCY,
  // Adoption is a frozen SET, so it can be judged over whatever subset RAN (HARNESS-081): a scan the
  // set expects but that did not run this pass is simply not judged, while every scan that did run
  // with a subject is held to whether it declared. `checkAdoption` gates whether the ratchet runs at
  // all (a caller passing three fixtures wants none); `writeAdoption` re-freezes the set from this
  // pass instead of judging it.
  // `context` and `advisoryNames` (PROC-016): under `pr`, a failing scan whose name is in
  // `advisoryNames` is TOLERATED — printed in full, surfaced on the advisory channel, and left out of
  // the verdict. `onOutcome` receives `{ tolerated, diagnosticReport }` so the caller can refuse to
  // write a receipt for a pass that leaned on tolerance and can persist a complete-run report.
  {
    checkAdoption = false,
    writeAdoption = false,
    knownNames = null,
    context = 'integration',
    advisoryNames = new Set(),
    onOutcome = null,
    onResults = null,
    diagnosticResults = null,
    onDiagnosticPublicationUnavailable = defaultPublicationUnavailableNotice,
  } = {},
) {
  if (!SCAN_CONTEXTS.includes(context)) {
    throw new Error(
      `run-all-scans: unknown context \`${context}\` (expected ${SCAN_CONTEXTS.join('|')})`,
    );
  }
  const results = new Array(scans.length);
  const scanFailureDiagnostics = new Array(scans.length);
  const configuredDiagnostics =
    diagnosticResults === null
      ? null
      : Array.isArray(diagnosticResults)
        ? diagnosticResults
        : [diagnosticResults];
  const publicationUnavailableCallback =
    typeof onDiagnosticPublicationUnavailable === 'function'
      ? onDiagnosticPublicationUnavailable
      : defaultPublicationUnavailableNotice;
  let publicationUnavailableReported = false;
  let publicationUnavailableNotice = null;
  function reportPublicationUnavailable(result) {
    if (publicationUnavailableReported) return;
    publicationUnavailableReported = true;
    try {
      publicationUnavailableNotice = Promise.resolve(publicationUnavailableCallback(result)).catch(
        () => {
          defaultPublicationUnavailableNotice(result);
        },
      );
    } catch {
      defaultPublicationUnavailableNotice(result);
    }
  }
  function emit(line) {
    try {
      write(line);
      return true;
    } catch (error) {
      if (configuredDiagnostics === null) throw error;
      reportPublicationUnavailable(publicationUnavailableDiagnostic(errorDetail(error)));
      return false;
    }
  }
  async function settlePublicationUnavailableNotice() {
    if (publicationUnavailableNotice !== null) await publicationUnavailableNotice;
  }
  function publishFailure(scan, result) {
    if (result.code === 0) return;
    const advisory = !result.unavailable && context === 'pr' && advisoryNames.has(result.name);
    const label = result.unavailable
      ? 'UNAVAILABLE — failed'
      : advisory
        ? 'FAILED — advisory in pr context'
        : 'FAILED';
    emit(`\n----- ${result.name} (${label}) -----`);
    const reproduce = reproductionCommand(scan);
    if (reproduce) emit(`[harness-scan] reproduce: ${reproduce}`);
    if (result.output.trim().length > 0) emit(result.output.replace(/\n+$/, ''));
  }
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= scans.length) return;
      const scan = scans[index];
      try {
        const outcome = await scan.run();
        const raw = normalizeScanOutcome(scan, index, outcome);
        results[index] = { ...raw, output: ensureExaminedDeclaration(scan, raw.output) };
        publishFailure(scan, results[index]);
      } catch (error) {
        if (configuredDiagnostics === null) throw error;
        scanFailureDiagnostics[index] = scanUnavailableDiagnostic(scan, index, error);
        results[index] = {
          name: scan.name,
          code: 1,
          output: `scan execution unavailable: ${errorDetail(error)}\n`,
          unavailable: true,
        };
        publishFailure(scan, results[index]);
      }
    }
  }
  const poolSize = Math.max(1, Math.min(concurrency, scans.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  // A tolerated failure is an advisory scan that failed under `pr`. It is printed EXACTLY like a
  // failure — the finding is real and the output is where it lives — and differs only in the verdict.
  const tolerated = new Set(
    results
      .filter(
        (result) =>
          !result.unavailable &&
          result.code !== 0 &&
          context === 'pr' &&
          advisoryNames.has(result.name),
      )
      .map((result) => result.name),
  );

  // Judged BEFORE the summary is printed, because the mark a scan gets depends on what it declared.
  const unavailableNames = new Set(
    results.filter((result) => result.unavailable).map((result) => result.name),
  );
  // A rejected scan did not examine anything, so it is reported as unavailable but excluded from
  // the adoption ratchet. Treating a synthetic empty output as an examined run would make a
  // dependency outage appear as an unrelated adoption-policy regression.
  const examined = results
    .filter((result) => !unavailableNames.has(result.name))
    .map((result) => ({
      name: result.name,
      ...judgeExamined(result.name, result.output),
    }));
  const skippedNames = new Set(examined.filter((e) => e.skipped).map((e) => e.name));

  emit('');
  emit('harness scan summary:');
  for (const result of results) {
    // Three marks, not two. A skip that renders as a tick is counted in "all N scans passed" and is
    // indistinguishable from a scan that examined its whole subject — the output above it may be
    // honest while the summary line is not, and the summary is the line people read.
    const mark = tolerated.has(result.name)
      ? '⚑'
      : unavailableNames.has(result.name)
        ? '⚠'
        : result.code !== 0
          ? '✗'
          : skippedNames.has(result.name)
            ? '↩'
            : '✓';
    emit(
      `${mark} ${result.name}${
        unavailableNames.has(result.name)
          ? ' (unavailable)'
          : tolerated.has(result.name)
            ? ' (advisory: failed, not blocking in pr context)'
            : ''
      }`,
    );
  }

  // ADVISORIES from EVERY scan, passing or failing (HARNESS-053). Deliberately placed after the
  // ✓/✗ list and before the verdict: high enough to be read, low enough that the verdict is still
  // the last line, so a green run still ENDS in green and the advisory cannot be mistaken for one.
  const advisories = results.flatMap((result) =>
    extractAdvisories(result.output).map((text) => ({ name: result.name, text })),
  );
  // A tolerated failure joins the advisory channel under its own name, so the summary carries the
  // fact in the one place advisories are read — and says where the same failure DOES block.
  for (const result of results) {
    if (!tolerated.has(result.name)) continue;
    advisories.push({
      name: result.name,
      text:
        `${ADVISORY_MARKER} failed (exit ${result.code}) — advisory in pr context, so it does not ` +
        'fail this run; the same failure BLOCKS the integration run on develop.',
    });
  }
  if (advisories.length > 0) {
    emit('');
    emit(
      `⚑ ${advisories.length} advisory finding(s) — NOT failures. The verdict below is unaffected.`,
    );
    for (const advisory of advisories) emit(`⚑ ${advisory.name}: ${advisory.text}`);
    emit('');
  }

  // The structured channel is intentionally independent of the scan verdict. This first seam is
  // opt-in while later migration slices classify every policy detector; it proves an actionable
  // finding or unavailable dependency stays visible without turning the caller's process red.
  let diagnosticReport = null;
  if (configuredDiagnostics !== null) {
    const diagnostics = [
      ...configuredDiagnostics,
      ...scanFailureDiagnostics.filter(Boolean),
      ...results
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.code !== 0)
        .map(({ result, index }) => scanFindingDiagnostic(result, index)),
    ];
    if (diagnostics.length > 0) {
      diagnosticReport = publishDiagnosticResults(diagnostics, emit, reportPublicationUnavailable);
    }
  }

  // HOW MUCH DID EACH ONE LOOK AT (HARNESS-057). An unearned zero fails the suite outright; the
  // ADOPTION set is a ratchet, because most scans declare nothing today and a check that is red on
  // arrival gets suppressed rather than obeyed.
  const unearnedZeros = examined.flatMap((e) => e.problems);
  const declaring = examined.filter((e) => e.declared).length;
  // The set-based ratchet judges NAMES. A scan DECLARES if it emitted `::examined::` at all — an
  // earned zero (`::examined:: 0 … ::expected-empty::`) is an adoption of the marker as much as a
  // positive count, so those belong in the set. EVALUABLE = every scan that ran; a `--skip`'d scan
  // never reaches here and so is neither judged nor faulted. (HARNESS-081)
  const declaringNames = examined.filter((e) => e.declared).map((e) => e.name);
  const evaluableNames = examined.map((e) => e.name);
  let adoption = { ok: true, message: null };
  if (writeAdoption) {
    const frozen = writeAdoptionBaseline(declaringNames, evaluableNames, knownNames);
    emit('');
    emit(
      `✎ re-froze examined-size adoption: ${frozen.length} scan(s) in ` +
        `${path.relative(WORKSPACE_ROOT, EXAMINED_ADOPTION_BASELINE_PATH)}.`,
    );
  } else if (checkAdoption) {
    adoption = judgeExaminedAdoption(declaringNames, evaluableNames, knownNames);
  }

  if (unearnedZeros.length > 0) {
    emit('');
    emit(`✗ ${unearnedZeros.length} scan(s) reported a pass over nothing:`);
    for (const problem of unearnedZeros) emit(`  ${problem}`);
  }
  if (adoption.message) {
    emit('');
    emit(adoption.message);
  }

  const failed = results.filter((result) => result.code !== 0 && !tolerated.has(result.name));
  if (typeof onOutcome === 'function') {
    onOutcome({ tolerated: [...tolerated], diagnosticReport });
  }
  if (typeof onResults === 'function') onResults(results);
  if (failed.length === 0 && unearnedZeros.length === 0 && adoption.ok) {
    // The count states what RAN. "all 97 scans passed" over a suite where two had no subject is a
    // stronger claim than the run supports — and a pass that tolerated an advisory failure says so
    // in the same line, so the verdict cannot be read as "nothing failed".
    const ran = results.length - skippedNames.size - tolerated.size - unavailableNames.size;
    const tail =
      (skippedNames.size > 0 ? `, ${skippedNames.size} skipped` : '') +
      (tolerated.size > 0 ? `, ${tolerated.size} advisory failure(s) tolerated (pr context)` : '') +
      (unavailableNames.size > 0 ? `, ${unavailableNames.size} unavailable` : '') +
      (diagnosticReport?.totals.nonClean > 0
        ? `, ${diagnosticReport.totals.nonClean} non-clean diagnostic result(s) reported`
        : '');
    emit(
      checkAdoption
        ? `${ran} scans passed${tail} (${declaring} declared what they examined)`
        : `${ran} scans passed${tail}`,
    );
    await settlePublicationUnavailableNotice();
    return 0;
  }
  if (failed.length > 0) emit(`${failed.length} of ${results.length} scans failed`);
  await settlePublicationUnavailableNotice();
  return 1;
}

/**
 * Parse `--skip <name>` occurrences (repeatable). Skips are REPORTED, never silent
 * (INFRA-026: CI runs the suite on a fresh checkout, where the `dist` freshness scan —
 * a local pre-CI check by charter — has nothing to measure).
 */
export function parseSkips(argv) {
  const skips = new Set();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skip' && argv[i + 1]) {
      skips.add(argv[i + 1]);
      i++;
    }
  }
  return skips;
}

/** The value after a `--flag`, or `undefined` when the flag is absent or has no value. */
export function parseFlagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/**
 * The runner's options as `main` reads them (PROC-016):
 *   --affected            run the scans the change reaches (plus every `always` scan)
 *   --changed a,b,c       the changed paths, given directly (tests, hooks that already know them)
 *   --base <ref>          the base to diff against; default = HARNESS_BASE_REF / GITHUB_BASE_REF /
 *                         origin/develop, as every other base-reading scan resolves it
 *   --context pr|integration   default integration; `pr` tolerates advisory-scan failures
 *   --list                print the selection and exit without running anything
 */
export function parseRunOptions(argv) {
  const context = parseFlagValue(argv, '--context') ?? 'integration';
  if (!SCAN_CONTEXTS.includes(context)) {
    throw new Error(`--context must be one of ${SCAN_CONTEXTS.join('|')}, got \`${context}\``);
  }
  const changedRaw = parseFlagValue(argv, '--changed');
  return {
    skips: parseSkips(argv),
    writeAdoption: argv.includes('--write-adoption-baseline'),
    affected: argv.includes('--affected'),
    list: argv.includes('--list'),
    context,
    base: parseFlagValue(argv, '--base') ?? null,
    changed:
      changedRaw === undefined
        ? null
        : changedRaw
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
  };
}

export async function main() {
  let options;
  try {
    options = parseRunOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
    return;
  }
  const { skips, writeAdoption, context } = options;
  const unknownSkips = [...skips].filter(
    (name) => !SCAN_COMMANDS.some((scan) => scan.name === name),
  );
  if (unknownSkips.length > 0) {
    process.stderr.write(`unknown --skip scan name(s): ${unknownSkips.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  for (const name of skips) {
    process.stdout.write(`skipped: ${name} (--skip)\n`);
  }
  let registry = selectScansForExecutionContext(
    SCAN_COMMANDS.filter(({ name }) => !skips.has(name)),
    { context },
  );

  // --affected (PROC-016): select what the change reaches. Every branch that cannot answer the
  // question — no base, no diff, an unclassifiable path — runs the whole registry and says why.
  if (options.affected) {
    let changed = options.changed;
    let why = null;
    if (changed === null) {
      const resolved = resolveChangedPaths({ explicitBase: options.base });
      if (resolved.error) {
        why = `could not compute changed paths (${resolved.error})`;
        changed = [];
      } else {
        changed = resolved.files;
        process.stdout.write(
          `affected: ${changed.length} changed path(s) against ${resolved.base}\n`,
        );
      }
    }
    const selection = why
      ? { selected: registry, excluded: [], full: true, reason: why }
      : selectAffectedScans(registry, changed);
    if (selection.full) {
      process.stdout.write(`affected: ${selection.reason}\n`);
    }
    process.stdout.write(`${describeAffectedSelection(selection)}\n`);
    registry = selection.selected;
  }
  process.stdout.write(`context: ${context}\n`);
  if (options.list) {
    for (const scan of registry) {
      process.stdout.write(`selected: ${scan.name}${scan.always ? ' (always)' : ''}\n`);
    }
    process.exitCode = 0;
    return;
  }

  let scans = registry.map(({ name, command }) => ({
    name,
    command,
    run: () => spawnScan(command),
  }));
  const advisoryNames = advisoryScanNames(SCAN_COMMANDS);
  // The adoption ratchet is a frozen SET, so it binds over whatever subset ran — CI's
  // `--skip dist --skip build-contracts` included, the one environment the old count-over-a-whole-
  // registry check could never reach (HARNESS-081). It is always judged (unless re-freezing).
  const scanNames = scans.map((scan) => scan.name);
  await publishHookDiagnosticInventory({
    root: WORKSPACE_ROOT,
    scanNames: SCAN_COMMANDS.map((scan) => scan.name),
    correlationId: 'hook-migration.full',
  });

  const invalidCacheDeclarations = registry.filter((scan) => scan.cacheable && scan.always);
  if (invalidCacheDeclarations.length > 0) {
    throw new Error(
      `always-run scans cannot be success-cached: ${invalidCacheDeclarations.map((scan) => scan.name).join(', ')}`,
    );
  }
  const successCache = inspectScanSuccessCache({
    scanNames,
    cacheableScanNames: registry.filter((scan) => scan.cacheable).map((scan) => scan.name),
    scanInputs: scanSuccessInputs(registry, collectFiles([], { cwd: WORKSPACE_ROOT })),
    scanCommands: new Map(registry.map((scan) => [scan.name, scan.command])),
    root: WORKSPACE_ROOT,
    context,
    writeAdoption,
  });
  if (successCache.hits.size > 0) {
    process.stdout.write(
      `${successCache.hits.size} independently proven scan success(es) restored; only misses will execute.\n`,
    );
    scans = applyScanSuccessCache(scans, successCache);
  } else {
    process.stdout.write(`▶ per-scan success cache not reused: ${successCache.reason}.\n`);
  }

  let outcome = { tolerated: [], diagnosticReport: null, results: [] };
  process.exitCode = await runScans(scans, undefined, undefined, {
    checkAdoption: true,
    writeAdoption,
    // The full registry — so a frozen scan deleted/renamed OUT of it is caught (GONE) instead of
    // rotting in the baseline forever. Distinct from a `--skip`'d scan, which is still registered.
    knownNames: SCAN_COMMANDS.map((scan) => scan.name),
    context,
    advisoryNames,
    diagnosticResults: [],
    onOutcome: (result) => {
      outcome = result;
    },
    onResults: (results) => {
      outcome.results = results;
    },
  });

  const recorded = recordSuccessfulScanResults({ cache: successCache, results: outcome.results });
  if (recorded > 0) {
    process.stdout.write(
      `${recorded} independently proven scan success(es) persisted for a retry.\n`,
    );
  }
}
if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
