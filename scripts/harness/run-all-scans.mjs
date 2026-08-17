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

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

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
 * advisory output currently thrown away (e.g. `scan-file-size`'s ratchet-tighten notices).
 */
export const ADVISORY_MARKER = '::advisory::';

/**
 * SGR colour sequences, stripped so a scan's own colouring does not leak into the summary.
 *
 * The ESC is written `\x1b`, not as a raw control byte, and it is part of the pattern deliberately:
 * without it the regex is `/\[[0-9;]*m/`, which matches any bracketed digits ending in `m`, so an
 * advisory whose text happened to mention `[12m` would have had it silently deleted. A sanitiser
 * that corrupts the message it is sanitising is worse than none. Both properties are pinned below.
 */
const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Advisory texts a scan emitted, in the order printed. Pure, so the rule is testable without
 * spawning anything.
 *
 * A marked line with no text after the marker is DROPPED rather than surfaced as an empty bullet —
 * an advisory channel that can print a contentless line is a way to look like it reported
 * something while reporting nothing, which is the class this whole item exists to close.
 */
export function extractAdvisories(output) {
  const advisories = [];
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.replace(ANSI_SGR_PATTERN, '');
    const markerAt = line.indexOf(ADVISORY_MARKER);
    if (markerAt === -1) continue;
    const text = line.slice(markerAt + ADVISORY_MARKER.length).trim();
    if (text.length > 0) advisories.push(text);
  }
  return advisories;
}

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
export const EXAMINED_MARKER = '::examined::';
export const EXPECTED_EMPTY_MARKER = '::expected-empty::';

/**
 * Every examined-size declaration in a scan's output.
 *
 * Returns `{ size, subject, expectedEmpty }` per declaration. A declaration whose count is not a
 * number is returned with `size: null` and treated as undeclared by the caller — a marker that says
 * nothing measurable is the contentless-advisory shape one channel over.
 */
export function extractExamined(output) {
  const found = [];
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.replace(ANSI_SGR_PATTERN, '');
    const at = line.indexOf(EXAMINED_MARKER);
    if (at === -1) continue;
    let rest = line.slice(at + EXAMINED_MARKER.length).trim();
    let expectedEmpty = null;
    const emptyAt = rest.indexOf(EXPECTED_EMPTY_MARKER);
    if (emptyAt !== -1) {
      expectedEmpty = rest.slice(emptyAt + EXPECTED_EMPTY_MARKER.length).trim() || null;
      rest = rest.slice(0, emptyAt).trim();
    }
    const match = /^(-?\d[\d,]*)\s*(.*)$/.exec(rest);
    found.push({
      size: match ? Number(match[1].replace(/,/g, '')) : null,
      subject: match ? match[2].trim() : rest,
      expectedEmpty,
    });
  }
  return found;
}

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
  // A scan that declared a zero AND said why is a SKIP, not a pass. It ran, found no subject, and
  // said so — which is a different fact from "examined the subject and found it clean", and the
  // summary is the line people actually read.
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
  // `knownNames` is the full scan registry when the caller has it. A frozen name absent from it was
  // deleted or renamed OUT of existence — it can never run again, so it would otherwise sit in the
  // baseline forever, un-FELL and un-pruned (the SET's blind spot the old count caught as a shrink).
  // When it is not supplied (fixture callers), the GONE check is simply skipped.
  const known = knownNames === null ? null : new Set(knownNames);
  const rel = path.relative(WORKSPACE_ROOT, EXAMINED_ADOPTION_BASELINE_PATH);
  // FELL: a scan the frozen set expects to declare, which ran this pass but did not.
  const fell = [...frozenSet].filter((name) => evaluable.has(name) && !declaring.has(name)).sort();
  // ROSE: a scan that declared this pass but is not yet frozen.
  const rose = [...declaring].filter((name) => !frozenSet.has(name)).sort();
  // GONE: a frozen scan that is no longer a registered scan at all.
  const gone = known === null ? [] : [...frozenSet].filter((name) => !known.has(name)).sort();
  // All three are reported TOGETHER — a set diff can carry more than one, and surfacing only the
  // first would spend a review round per finding, the waste this repo's culture is closing.
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
 */
export const SCAN_COMMANDS = [
  { name: 'consistency', command: ['node', 'scripts/harness/scan-consistency.mjs'] },
  { name: 'memory-mirror', command: ['node', 'scripts/harness/scan-memory-mirror.mjs'] },
  { name: 'spec-research', command: ['node', 'scripts/harness/scan-spec-research.mjs'] },
  { name: 'orchestration-map', command: ['node', 'scripts/harness/scan-orchestration-map.mjs'] },
  { name: 'deployment-matrix', command: ['node', 'scripts/harness/scan-deployment-matrix.mjs'] },
  {
    name: 'orchestration-neutrality',
    command: ['node', 'scripts/harness/scan-orchestration-neutrality.mjs'],
  },
  { name: 'hook-catalog', command: ['node', 'scripts/harness/scan-hook-catalog.mjs'] },
  {
    // INFRA-078 — `hooks-have-execution-coverage` proves a hook CAN run; nothing read the file that
    // decides whether the deployment CALLS it, so a hook registered to no event, and a matcher
    // naming a deleted file, both stayed green.
    name: 'hook-registration',
    command: ['node', 'scripts/harness/scan-hook-registration.mjs'],
  },
  { name: 'review-findings', command: ['node', 'scripts/harness/scan-review-findings.mjs'] },
  {
    name: 'review-token-supply',
    command: ['node', 'scripts/harness/scan-review-token-supply.mjs'],
  },
  {
    name: 'claude-review-coverage',
    command: ['node', 'scripts/harness/scan-claude-review-coverage.mjs'],
  },
  {
    name: 'workflow-permissions',
    command: ['node', 'scripts/harness/scan-workflow-permissions.mjs'],
  },
  {
    // INFRA-059 — `deploy.yml` referenced a repository that does not exist for eight months: an (allow-missing-artifact: INFRA-058 deleted the workflow; this names why the scan exists)
    // unresolvable `uses:` dies at `Set up job`, so there is no failing step to read and a skipped
    // job reports the run green. The resolvability half runs in CI (see the scan's header for why
    // it stays off on a promotion to `main`); the static half runs everywhere.
    name: 'action-references',
    command: ['node', 'scripts/harness/scan-action-references.mjs'],
  },
  {
    // A rule or routing document that names a mechanism (a harness script, a hook, a package
    // script, an MCP server) must name one that resolves — a phantom name reads as satisfiable.
    name: 'named-mechanism-resolves',
    command: ['node', 'scripts/harness/scan-named-mechanism-resolves.mjs'],
  },
  {
    name: 'hook-syntax',
    command: ['node', 'scripts/harness/scan-hook-syntax.mjs'],
  },
  {
    // Skills counterpart to INFRA-078's hook-registration floor. Measured on session 50cb28dd:
    // 53 skills on disk, 5 registered, 3 of those dangling, and every project-skill invocation
    // returned `Unknown skill` (13/13) because two hooks order skills by name on every prompt.
    name: 'skill-registration',
    command: ['node', 'scripts/harness/scan-skill-registration.mjs'],
  },
  { name: 'document-authority', command: ['node', 'scripts/harness/check-document-authority.mjs'] },
  { name: 'commands', command: ['node', 'scripts/harness/check-command-layering.mjs'] },
  {
    name: 'capability-placement',
    command: ['node', 'scripts/harness/check-capability-placement.mjs'],
  },
  {
    name: 'nested-package-glob-coverage',
    command: ['node', 'scripts/harness/check-nested-package-glob-coverage.mjs'],
  },
  {
    name: 'background-workspace',
    command: ['node', 'scripts/harness/check-background-workspace-conformance.mjs'],
  },
  {
    name: 'agent-server-boundary',
    command: ['node', 'scripts/harness/check-agent-server-boundary.mjs'],
  },
  { name: 'sdk-public-surface', command: ['node', 'scripts/harness/check-sdk-public-surface.mjs'] },
  { name: 'specs', command: ['node', 'scripts/harness/audit-spec-coverage.mjs'] },
  { name: 'spec-paths', command: ['node', 'scripts/harness/check-spec-paths.mjs'] },
  {
    name: 'arch-map-paths',
    command: ['node', 'scripts/harness/check-architecture-map-paths.mjs'],
  },
  {
    name: 'arch-map-completeness',
    command: ['node', 'scripts/harness/check-architecture-map-completeness.mjs'],
  },
  {
    name: 'document-standards',
    command: ['node', 'scripts/harness/check-document-standards-index.mjs'],
  },
  {
    name: 'agent-def-convention',
    command: ['node', 'scripts/harness/check-agent-def-convention.mjs'],
  },
  {
    name: 'fixture-floor',
    command: ['node', 'scripts/harness/check-fixture-floor.mjs'],
  },
  {
    name: 'contract-disposition',
    command: ['node', 'scripts/harness/check-contract-disposition.mjs'],
  },
  {
    name: 'design-doc',
    command: ['node', 'scripts/harness/check-design-doc-completeness.mjs'],
  },
  {
    name: 'spec-whitebox-leakage',
    command: ['node', 'scripts/harness/check-spec-whitebox-leakage.mjs'],
  },
  {
    name: 'adr',
    command: ['node', 'scripts/harness/check-adr-completeness.mjs'],
  },
  {
    name: 'spec-doc-frontmatter',
    command: ['node', 'scripts/harness/check-spec-doc-frontmatter.mjs'],
  },
  {
    name: 'spec-public-surface',
    command: ['node', 'scripts/harness/check-spec-public-surface.mjs'],
  },
  {
    name: 'harness-config-paths',
    command: ['node', 'scripts/harness/check-harness-config-paths.mjs'],
  },
  { name: 'workspace-refs', command: ['node', 'scripts/harness/check-workspace-refs.mjs'] },
  {
    name: 'ghost-package-refs',
    command: ['node', 'scripts/harness/check-ghost-package-refs.mjs'],
  },
  { name: 'stub-markers', command: ['node', 'scripts/harness/check-stub-markers.mjs'] },
  { name: 'conflict-markers', command: ['node', 'scripts/harness/scan-conflict-markers.mjs'] },
  // INFRA-102. Only the DECLARED edge runs here: it is hermetic. The `--measured` edge asks the
  // host toolchain what a workspace script actually runs on, which no manifest edit can make true
  // (Volta binds a package tool to its install-time Node), so it is a developer-run check.
  {
    name: 'node-version-single-valued',
    command: ['node', 'scripts/harness/scan-node-version-single-valued.mjs'],
  },
  // HARNESS-105. The user-execution gate section is required BEFORE implementation starts, and
  // nothing enforced it — 217 of 257 `done/` documents had none when this floor was written. The
  // baseline freezes that set; documents outside it must carry the section.
  {
    name: 'spec-user-execution-section',
    command: ['node', 'scripts/harness/scan-spec-user-execution-section.mjs'],
  },
  // D1. operational.md requires the three routing documents to stay lean, and scan-file-size scopes
  // itself to packages/apps, so nothing could see them — three of three were in violation. The
  // ratchet enforces the direction; the gap to the 80-line target is reported every run.
  {
    name: 'routing-document-size',
    command: ['node', 'scripts/harness/scan-routing-document-size.mjs'],
  },
  { name: 'shell-portability', command: ['node', 'scripts/harness/scan-shell-portability.mjs'] },
  { name: 'ci-base-history', command: ['node', 'scripts/harness/scan-ci-base-history.mjs'] },
  {
    name: 'automerge-disarm-permission',
    command: ['node', 'scripts/harness/scan-automerge-disarm-permission.mjs'],
  },
  {
    name: 'promotion-ancestry',
    command: ['node', 'scripts/harness/scan-promotion-ancestry.mjs'],
  },
  {
    name: 'main-required-checks',
    command: ['node', 'scripts/harness/scan-main-required-checks.mjs'],
  },
  // INFRA-097. A required check triggered by `pull_request` loads its YAML from the PR, so the
  // change carries the control plane that judges it. This makes such an edit visible; it does not
  // make the control plane trusted — that needs configuration outside this repository.
  {
    name: 'workflow-provenance',
    command: ['node', 'scripts/harness/scan-workflow-provenance.mjs'],
  },
  {
    name: 'new-rule-declares-enforcement',
    command: ['node', 'scripts/harness/scan-new-rule-declares-enforcement.mjs'],
  },
  {
    name: 'named-artifact-resolves',
    command: ['node', 'scripts/harness/scan-named-artifact-resolves.mjs'],
  },
  {
    name: 'required-check-local-reachability',
    command: ['node', 'scripts/harness/scan-required-check-local-reachability.mjs'],
  },
  {
    name: 'required-check-needs',
    command: ['node', 'scripts/harness/scan-required-check-needs.mjs'],
  },
  {
    name: 'test-selection-tolerance',
    command: ['node', 'scripts/harness/scan-test-selection-tolerance.mjs'],
  },
  {
    // INFRA-063 D7 — `pnpm test` is `-r --if-present test`, which walks past every suite declared
    // under any other name. The release gate ran one of them (`test:bin`) only because someone had
    // written it in by hand, and never saw `agent-cli-web`'s `test:e2e` at all. Enumerates every
    // `^test(:|$)` script and requires each to be run or excluded with a re-verified reason.
    name: 'release-sweep-coverage',
    command: ['node', 'scripts/harness/scan-release-sweep-coverage.mjs'],
  },
  {
    // INFRA-060 D4 — the affected-scope calculator resolved build tooling to ZERO scopes, so a PR
    // changing how every package is built left the REQUIRED `build` and `quality` checks green
    // having verified nothing. Executes the calculator against each declared path.
    name: 'build-tooling-scope',
    command: ['node', 'scripts/harness/scan-build-tooling-scope.mjs'],
  },
  { name: 'no-fallback', command: ['node', 'scripts/harness/scan-no-fallback.mjs'] },
  // CORE-030: a produced tool with no declared permission profile takes the fail-safe fallback,
  // which prompts on every call and is refused in plan mode. Silent, and it had already happened.
  {
    name: 'tool-classification',
    command: ['node', 'scripts/harness/scan-tool-classification.mjs'],
  },
  {
    // HARNESS-072 tractable subset: a quantified loop bound has one owner (the skill); the map and
    // the rules point rather than restate. #1615 produced five contradictions this way in one PR.
    name: 'loopback-bound-ownership',
    command: ['node', 'scripts/harness/scan-loopback-bound-ownership.mjs'],
  },
  {
    name: 'transport-admission',
    command: ['node', 'scripts/harness/scan-transport-admission.mjs'],
  },
  {
    name: 'transport-conformance',
    command: ['node', 'scripts/harness/scan-transport-conformance.mjs'],
  },
  {
    name: 'browser-package-node-subpath',
    command: ['node', 'scripts/harness/scan-browser-package-node-subpath.mjs'],
  },
  { name: 'authority-bypass', command: ['node', 'scripts/harness/scan-authority-bypass.mjs'] },
  {
    name: 'run-advancement-owner',
    command: ['node', 'scripts/harness/scan-run-advancement-owner.mjs'],
  },
  {
    name: 'contract-cast-ratchet',
    command: ['node', 'scripts/harness/scan-contract-cast-ratchet.mjs'],
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
  },
  {
    // ARCH-029 TC-06: role ports carry no optional members. An aggregate-level optional CEILING
    // would not have caught the regression this guards, which is why the rule is per-port.
    name: 'role-port-optionals',
    command: ['node', 'scripts/harness/scan-role-port-optionals.mjs'],
  },
  {
    // ARCH-013 stage 2: a resolved-preset field must reach a declared projection surface, and the
    // startup and live-/preset surfaces must agree. Stage 1's scan-option-reachability covers the
    // LAST hop of the same chain (a declared session option nothing assigns); this covers the FIRST.
    // The divergence half is the `effort` class: a field one path applies and the other drops means
    // one session holds two answers for the same preset depending on when it was chosen.
    name: 'preset-projection',
    command: ['node', 'scripts/harness/scan-preset-projection.mjs'],
  },
  {
    name: 'literal-cast-union',
    command: ['node', 'scripts/harness/scan-literal-cast-union.mjs'],
  },
  {
    name: 'option-reachability',
    command: ['node', 'scripts/harness/scan-option-reachability.mjs'],
  },
  {
    name: 'publish-registry',
    command: ['node', 'scripts/harness/scan-publish-registry.mjs'],
  },
  {
    name: 'product-identity',
    command: ['node', 'scripts/harness/scan-product-identity.mjs'],
  },
  {
    name: 'harness-script-import-safety',
    command: ['node', 'scripts/harness/scan-harness-script-import-safety.mjs'],
  },
  {
    name: 'ci-concurrency-footprint',
    command: ['node', 'scripts/harness/scan-ci-concurrency-footprint.mjs'],
  },
  {
    name: 'runner-wait',
    command: ['node', 'scripts/harness/scan-runner-wait.mjs'],
  },
  {
    name: 'rule-case-narrative',
    command: ['node', 'scripts/harness/scan-rule-case-narrative.mjs'],
  },
  {
    name: 'loop-contract',
    command: ['node', 'scripts/harness/scan-loop-contract.mjs'],
  },
  {
    name: 'resolving-claims',
    command: ['node', 'scripts/harness/scan-resolving-claims.mjs'],
  },
  {
    name: 'mistake-mechanisms',
    command: ['node', 'scripts/harness/scan-mistake-mechanisms.mjs'],
  },
  {
    name: 'harness-scope-literal',
    command: ['node', 'scripts/harness/scan-harness-scope-literal.mjs'],
  },
  {
    name: 'release-verification-gate',
    command: ['node', 'scripts/harness/scan-release-verification-gate.mjs'],
  },
  {
    name: 'legacy-typescript',
    command: ['node', 'scripts/harness/scan-legacy-typescript.mjs'],
  },
  { name: 'no-fake-in-src', command: ['node', 'scripts/harness/scan-no-fake-in-src.mjs'] },
  {
    name: 'measurement-provenance',
    command: ['node', 'scripts/harness/scan-measurement-provenance.mjs'],
  },
  { name: 'helper-limits', command: ['node', 'scripts/harness/scan-helper-limits.mjs'] },
  {
    // HARNESS-052 — the audited "success over work it did not do" shape wearing a test: an
    // assertion that no implementation of the code under test could fail.
    name: 'tautological-assertions',
    command: ['node', 'scripts/harness/scan-tautological-assertions.mjs'],
  },
  {
    // HARNESS-052 — and the same shape wearing a GUARD: a scan whose governed tree is absent and
    // which reports a pass rather than an error.
    name: 'guard-scope-fail-closed',
    command: ['node', 'scripts/harness/scan-guard-scope-fail-closed.mjs'],
  },
  { name: 'api-pagination', command: ['node', 'scripts/harness/scan-api-pagination.mjs'] },
  {
    name: 'live-smoke-provider-coverage',
    command: ['node', 'scripts/harness/scan-live-smoke-provider-coverage.mjs'],
  },
  {
    name: 'composition-neutrality',
    command: ['node', 'scripts/harness/scan-composition-neutrality.mjs'],
  },
  {
    name: 'session-artifact-neutrality',
    command: ['node', 'scripts/harness/scan-session-artifact-neutrality.mjs'],
  },
  {
    name: 'agent-tools-neutrality',
    command: ['node', 'scripts/harness/scan-agent-tools-neutrality.mjs'],
  },
  {
    name: 'memory-neutrality',
    command: ['node', 'scripts/harness/scan-memory-neutrality.mjs'],
  },
  {
    name: 'evals-neutrality',
    command: ['node', 'scripts/harness/scan-evals-neutrality.mjs'],
  },
  {
    name: 'prompt-prose',
    command: ['node', 'scripts/harness/scan-prompt-prose.mjs'],
  },
  {
    name: 'capability-reachability',
    command: ['node', 'scripts/harness/scan-capability-reachability.mjs'],
  },
  {
    name: 'progress-report-quantification',
    command: ['node', 'scripts/harness/scan-progress-report-quantification.mjs'],
  },
  { name: 'deprecated-markers', command: ['node', 'scripts/harness/scan-deprecated-markers.mjs'] },
  { name: 'done-evidence', command: ['node', 'scripts/harness/check-done-evidence.mjs'] },
  {
    // HARNESS-050 — the companion to done-evidence: that one guards evidence DECAY (a cited path
    // that later vanished), this one guards evidence that was NEVER THERE.
    name: 'unearned-done-claims',
    command: ['node', 'scripts/harness/scan-unearned-done-claims.mjs'],
  },
  { name: 'task-archival', command: ['node', 'scripts/harness/check-task-archival.mjs'] },
  { name: 'test-module-mocks', command: ['node', 'scripts/harness/check-test-module-mocks.mjs'] },
  { name: 'backlog-placement', command: ['node', 'scripts/harness/check-backlog-placement.mjs'] },
  { name: 'doc-examples', command: ['node', 'scripts/harness/check-doc-examples.mjs'] },
  { name: 'llms-txt', command: ['node', 'scripts/harness/check-llms-txt.mjs'] },
  {
    name: 'temp-script-placement',
    command: ['node', 'scripts/harness/check-temp-script-placement.mjs'],
  },
  { name: 'orphan-exports', command: ['node', 'scripts/harness/check-orphan-exports.mjs'] },
  { name: 'deps', command: ['node', 'scripts/harness/check-dependency-direction.mjs'] },
  { name: 'dep-kind', command: ['node', 'scripts/harness/check-dep-kind.mjs'] },
  {
    name: 'interface-imports',
    command: ['node', 'scripts/harness/check-interface-imports.mjs'],
  },
  {
    name: 'interface-runtime',
    command: ['node', 'scripts/harness/scan-interface-runtime.mjs'],
  },
  {
    // ARCH-021: the same family as interface-runtime — "package X's src/ must not import Y". This one
    // holds the TOOL axis, which the manifest edge cannot cut (ARCH-035 / #1787).
    name: 'subagent-runner-composition',
    command: ['node', 'scripts/harness/scan-subagent-runner-composition.mjs'],
  },
  { name: 'publish', command: ['node', 'scripts/harness/check-publish-safety.mjs'] },
  { name: 'release-governance', command: ['node', 'scripts/harness/check-release-governance.mjs'] },
  { name: 'test-plans', command: ['node', 'scripts/harness/scan-test-plan.mjs'] },
  {
    name: 'functional-coverage',
    command: ['node', 'scripts/harness/check-functional-coverage.mjs'],
  },
  {
    name: 'coverage-scripts',
    command: ['node', 'scripts/harness/check-test-coverage-scripts.mjs'],
  },
  { name: 'file-size', command: ['node', 'scripts/harness/scan-file-size.mjs'] },
  {
    name: 'build-contracts',
    command: ['node', 'scripts/harness/check-build-output-contracts.mjs'],
  },
  { name: 'dist', command: ['node', 'scripts/harness/scan-dist-freshness.mjs'] },
  {
    name: 'doc-folder-status',
    command: ['node', 'scripts/harness/scan-doc-folder-status-agreement.mjs'],
  },
  {
    name: 'vitest-resource-ceiling',
    command: ['node', 'scripts/harness/scan-vitest-resource-ceiling.mjs'],
  },
  { name: 'docs-structure', command: ['pnpm', 'docs:validate-structure'] },
];

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

/**
 * Run scans with BOUNDED CONCURRENCY (INFRA-037), never early-exiting, then emit a final summary.
 * Each scan is `{ name, run: () => Promise<{code, output}> | Promise<number> }`. Output is CAPTURED per
 * scan and printed only for FAILURES (passes stay a one-line ✓), so parallel runs do not interleave.
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
  { checkAdoption = false, writeAdoption = false, knownNames = null } = {},
) {
  const results = new Array(scans.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= scans.length) return;
      const scan = scans[index];
      const outcome = await scan.run();
      results[index] =
        typeof outcome === 'number'
          ? { name: scan.name, code: outcome, output: '' }
          : { name: scan.name, code: outcome.code, output: outcome.output ?? '' };
    }
  }
  const poolSize = Math.max(1, Math.min(concurrency, scans.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  // Surface the full captured output of each FAILED scan (in original order) for debuggability.
  for (const result of results) {
    if (result.code !== 0 && result.output.trim().length > 0) {
      write(`\n----- ${result.name} (FAILED) -----`);
      write(result.output.replace(/\n+$/, ''));
    }
  }

  // Judged BEFORE the summary is printed, because the mark a scan gets depends on what it declared.
  const examined = results.map((result) => ({
    name: result.name,
    ...judgeExamined(result.name, result.output),
  }));
  const skippedNames = new Set(examined.filter((e) => e.skipped).map((e) => e.name));

  write('');
  write('harness scan summary:');
  for (const result of results) {
    // Three marks, not two. A skip that renders as a tick is counted in "all N scans passed" and is
    // indistinguishable from a scan that examined its whole subject — the output above it may be
    // honest while the summary line is not, and the summary is the line people read.
    const mark = result.code !== 0 ? '✗' : skippedNames.has(result.name) ? '↩' : '✓';
    write(`${mark} ${result.name}`);
  }

  // ADVISORIES from EVERY scan, passing or failing (HARNESS-053). Deliberately placed after the
  // ✓/✗ list and before the verdict: high enough to be read, low enough that the verdict is still
  // the last line, so a green run still ENDS in green and the advisory cannot be mistaken for one.
  const advisories = results.flatMap((result) =>
    extractAdvisories(result.output).map((text) => ({ name: result.name, text })),
  );
  if (advisories.length > 0) {
    write('');
    write(
      `⚑ ${advisories.length} advisory finding(s) — NOT failures. The verdict below is unaffected.`,
    );
    for (const advisory of advisories) write(`⚑ ${advisory.name}: ${advisory.text}`);
    write('');
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
    write('');
    write(
      `✎ re-froze examined-size adoption: ${frozen.length} scan(s) in ` +
        `${path.relative(WORKSPACE_ROOT, EXAMINED_ADOPTION_BASELINE_PATH)}.`,
    );
  } else if (checkAdoption) {
    adoption = judgeExaminedAdoption(declaringNames, evaluableNames, knownNames);
  }

  if (unearnedZeros.length > 0) {
    write('');
    write(`✗ ${unearnedZeros.length} scan(s) reported a pass over nothing:`);
    for (const problem of unearnedZeros) write(`  ${problem}`);
  }
  if (adoption.message) {
    write('');
    write(adoption.message);
  }

  const failed = results.filter((result) => result.code !== 0);
  if (failed.length === 0 && unearnedZeros.length === 0 && adoption.ok) {
    // The count states what RAN. "all 97 scans passed" over a suite where two had no subject is a
    // stronger claim than the run supports.
    const ran = results.length - skippedNames.size;
    const tail = skippedNames.size > 0 ? `, ${skippedNames.size} skipped` : '';
    write(
      checkAdoption
        ? `${ran} scans passed${tail} (${declaring} declared what they examined)`
        : `${ran} scans passed${tail}`,
    );
    return 0;
  }
  if (failed.length > 0) write(`${failed.length} of ${results.length} scans failed`);
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

export async function main() {
  const skips = parseSkips(process.argv.slice(2));
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
  const writeAdoption = process.argv.slice(2).includes('--write-adoption-baseline');
  const scans = SCAN_COMMANDS.filter(({ name }) => !skips.has(name)).map(({ name, command }) => ({
    name,
    run: () => spawnScan(command),
  }));
  // The adoption ratchet is a frozen SET, so it binds over whatever subset ran — CI's
  // `--skip dist --skip build-contracts` included, the one environment the old count-over-a-whole-
  // registry check could never reach (HARNESS-081). It is always judged (unless re-freezing).
  process.exitCode = await runScans(scans, undefined, undefined, {
    checkAdoption: true,
    writeAdoption,
    // The full registry — so a frozen scan deleted/renamed OUT of it is caught (GONE) instead of
    // rotting in the baseline forever. Distinct from a `--skip`'d scan, which is still registered.
    knownNames: SCAN_COMMANDS.map((scan) => scan.name),
  });
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
