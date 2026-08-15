---
status: review-ready
type: INFRA
tags: [cli, typescript]
---

# INFRA-100: Make harness verification portable on the supported macOS toolchain

## Problem

On macOS with the repository-pinned Node 22.14.0 and the system `/bin/bash` 3.2,
`pnpm harness:verify -- --scope packages/agent-provider-replay --include-scenarios` reaches the
repository harness tests but fails 27 cases. Twenty failures come from temporary fixture paths whose
`/var/...` spelling resolves to `/private/var/...`, so direct-execution guards compare two spellings of
the same file and silently skip their `main()`. Six execution-witness failures come from dynamic file
descriptor syntax and `BASH_XTRACEFD`, which the system Bash cannot provide. One worktree-lock test uses
GNU `date +%s%3N`; BSD `date` prints a non-millisecond value, making both interval endpoints identical.

With `TMPDIR` set to its `realpath`, the path-alias failures disappear and the remaining seven failures
reproduce deterministically. These are repository-level verification defects: they block every scoped
harness gate on a supported development host even though the changed package is unrelated.

## Prior Art Research

### Observed common behavior

1. **Bash execution-line evidence.** Bash `set -x` emits expanded commands before execution, prefixes
   them with expanded `PS4`, and normally writes the trace to standard error. `PS4` can carry a stable
   marker plus `${BASH_SOURCE}:${LINENO}`. A `DEBUG` trap can write directly to a separate file, but its
   inheritance into functions, substitutions, and subshells depends on tracing options and therefore
   must be enabled and tested explicitly. [Bash `set -x` and `PS4`](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html),
   [Bash variables](https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html),
   [Bash DEBUG-trap inheritance](https://www.gnu.org/software/bash/manual/html_node/Major-Differences-From-The-Bourne-Shell.html)
2. **Portable millisecond timing.** GNU documents `%N` as an extension, so `date +%s%3N` is not a
   portable clock. Node 22 provides `performance.now()` for high-resolution elapsed milliseconds and
   `process.hrtime.bigint()` when integer nanosecond arithmetic is needed. The harness already requires
   Node 22, so Node—not a platform-specific `date`—should own timing.
   [GNU time conversion specifiers](https://www.gnu.org/software/coreutils/manual/html_node/Time-conversion-specifiers.html),
   [Node 22 `performance.now()`](https://nodejs.org/download/release/v22.14.0/docs/api/perf_hooks.html#performancenow)
3. **Canonical temporary paths.** Node's temporary directory honors environment overrides, while the
   same macOS filesystem object may be exposed through `/var/...` and `/private/var/...`. Existing path
   identity must therefore be resolved with `fs.realpath` before it is compared or supplied as a fixture
   root. [Node 22 `fs.realpath`](https://nodejs.org/download/release/v22.14.0/docs/api/fs.html#fspromisesrealpathpath-options),
   [Apple path resolution behavior](https://developer.apple.com/documentation/foundation/nsurl/resolvingsymlinksinpath)

### Constraint for Robota

- macOS `/bin/bash` 3.2 must produce execution evidence without dynamic descriptors or
  `BASH_XTRACEFD`.
- The witness must keep ordinary stderr intact, preserve the child exit status, and prove actual
  executed lines rather than scan source text.
- Linux and macOS must use the same Node-owned timing and canonical temporary-root behavior.
- Raw traces may contain expanded arguments, so they remain ephemeral local evidence.

## Architecture Review

### Affected Scope

- `scripts/harness/lib/execution-witness.mjs` — Bash execution-line evidence prelude.
- `scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs` — Bash 3.2,
  stderr-isolation, branch, function/subshell reachability evidence.
- `scripts/harness/__tests__/worktrees-share-the-stash.test.mjs` — portable concurrent-interval clock.
- `scripts/harness/verify-change.mjs` — canonical temporary root injected only into the harness-test
  subprocess.
- `scripts/harness/__tests__/harness-scripts.test.mjs` — canonical temporary-root projection contract.

### Alternatives Considered

1. **Require local Bash 5 and GNU coreutils.** Pro: preserves the current implementation. Con: violates
   the supported stock macOS toolchain, adds host setup outside the repository, and still leaves the
   `/var` path-alias defect.
2. **Skip the affected tests on macOS.** Pro: small change. Con: converts missing evidence into a green
   gate and allows precisely the execution/locking regressions the tests are meant to catch.
3. **Use platform-neutral evidence primitives and canonicalize the harness-test temp root.** Pro: one
   behavior on Linux and macOS, no external tool installation, actual execution evidence remains
   fail-closed. Con: the Bash witness must explicitly test DEBUG-trap inheritance and fixed descriptor
   isolation.
4. **Replace all direct-execution guards repository-wide with realpath comparisons.** Pro: makes every
   copied script alias-tolerant independently. Con: changes more than 100 harness entrypoints and their
   fixtures when only the harness-test subprocess creates aliased temporary copies; the blast radius is
   disproportionate to this failure.

### Decision

Choose alternative 3. `verify-change` resolves `os.tmpdir()` once with `realpathSync` and passes that
canonical value as `TMPDIR` only to its `harness-tests` child process. The Bash prelude uses a dedicated
fixed high-numbered descriptor plus a `DEBUG` trap with function-trace inheritance enabled, retaining
the current out-of-band trace file and ordinary stderr. Existing branch evidence is extended with a
function/subshell case so inheritance is measured rather than assumed. The lock test records its `IN`
and `OUT` observations against a single parent-process `performance.now()` clock rather than shelling
out to `date`.

This preserves every existing consumer: `witnessOneCase` still reads the same tagged trace file,
`runVitestRaw` still receives the same two environment variables, and `verify-change` still runs the
same complete harness test directory. Failure modes were checked adversarially: missing trace output
remains `UNKNOWN`, noncanonical fixture paths can no longer silently suppress a copied CLI, ordinary
stderr remains visible, and the unlocked lock fixture must still demonstrate real overlap.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — execution-witness callers, harness-test launcher, and worktree-lock tests inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add a pure `canonicalTemporaryDirectory()` helper in `verify-change.mjs` and project its result into
   the `harness-tests` child environment; test the realpath identity and dry-run command contract.
2. Replace the Bash-4-only xtrace prelude with a Bash-3-compatible, out-of-band `DEBUG`-trap recorder on
   a dedicated descriptor, explicitly enabling inheritance. Keep the existing trace syntax consumed by
   `parseXtrace`.
3. Extend the witness tests to prove executed/not-executed branches, function/subshell reachability,
   unchanged ordinary stderr, and inert behavior without the trace environment.
4. Refactor the worktree concurrency fixture so its parent Node process timestamps parsed `IN`/`OUT`
   markers with `performance.now()`; preserve the locked non-overlap and unlocked-overlap assertions.
5. Run the focused RED/GREEN suites, the complete harness test directory, and the original scoped
   ARCH-014 verification command without an ad-hoc `TMPDIR` override.

## Affected Files

- `scripts/harness/verify-change.mjs`
- `scripts/harness/__tests__/harness-scripts.test.mjs`
- `scripts/harness/lib/execution-witness.mjs`
- `scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs`
- `scripts/harness/__tests__/worktrees-share-the-stash.test.mjs`
- `.agents/tasks/INFRA-100-macos-harness-portability.md`

## Completion Criteria

- [ ] TC-01: On macOS Bash 3.2, the execution-witness test records only executed branch lines, reaches
      function/subshell lines, leaves ordinary stderr unchanged, and exits 0.
- [ ] TC-02: The worktree-lock suite uses no `date +%s%3N`, proves locked intervals do not overlap and
      unlocked intervals do overlap, and exits 0 on macOS and Linux.
- [ ] TC-03: The harness-test launcher supplies `realpathSync(tmpdir())` as `TMPDIR`, while every other
      repository check keeps its existing environment contract.
- [ ] TC-04: `pnpm exec vitest run scripts/harness/__tests__ --pool=threads --maxWorkers=2
  --testTimeout=30000 --reporter=dot` exits 0 when invoked through `pnpm harness:verify` without a
      caller-provided `TMPDIR` override.
- [ ] TC-05: `pnpm harness:verify -- --scope packages/agent-provider-replay --include-scenarios` exits 0
      and reports a matching canonical `external-payload-replay.record.json`.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                | Notes |
| ----- | ------------------------ | ------------------------------------------------------------------------------ | ----- |
| TC-01 | CI pipeline smoke test   | Focused Vitest execution-witness suite under stock `/bin/bash`                 |       |
| TC-02 | CI pipeline smoke test   | Focused Vitest worktree-lock suite on macOS locally and Linux CI               |       |
| TC-03 | Unit test                | `harness-scripts.test.mjs` projection assertion plus realpath identity fixture |       |
| TC-04 | CI pipeline smoke test   | Complete `scripts/harness/__tests__` invocation through `harness:verify`       |       |
| TC-05 | Process integration test | Scoped harness verification with package-owned scenario record comparison      |       |

## Tasks

- [ ] `.agents/tasks/INFRA-100-macos-harness-portability.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-15

**Status upgrade:** draft → review-ready

- Frontmatter block: file begins with YAML frontmatter and declares `status: draft`.
- Frontmatter type: `type: INFRA` is one of the 11 permitted taxonomy values.
- Frontmatter tags: `tags: [cli, typescript]` is present.
- Problem symptom: names the failing scoped `harness:verify` command and quantifies the 27 failures by cause.
- Problem reproduction: identifies stock macOS `/bin/bash` 3.2 with repository-pinned Node 22.14.0 and the `TMPDIR` canonicalization control result.
- Problem quality: contains neither `TBD` nor `TODO` and is a substantiated multi-paragraph diagnosis.
- Prior Art Research presence: `## Prior Art Research` is present.
- Prior Art Research substantiation: cites GNU Bash, GNU Coreutils, Node.js 22, and Apple documentation sources.
- Research-to-decision trace: Bash tracing, Node-owned timing, and realpath identity findings feed alternatives 1–4 and the choice of alternative 3.
- Architecture checklist: all four required items are checked.
- Sibling scan: checked with evidence naming execution-witness callers, the harness-test launcher, and worktree-lock tests.
- Alternatives: four alternatives each state a concrete pro and con.
- Decision trade-off: chooses portable shared primitives and scoped temp-root canonicalization to preserve evidence while avoiding host prerequisites, skipped tests, and repository-wide churn.
- New-surface placement: N/A — the document changes internal harness implementation and tests only; it introduces no package, app, presentation, public interface, layer reclassification, or product-family boundary.
- Completion Criteria identifiers: all five items use unique `TC-01` through `TC-05` prefixes.
- Completion Criteria coverage: distinct criteria cover execution tracing, timing/locking, temp-root projection, full harness tests, and the original scoped verification scenario.
- Completion Criteria observability: every criterion names an exact command result or externally observable trace, timing, environment, or scenario-record behavior.
- Completion Criteria wording: none uses “works correctly”, “no errors”, “implemented”, or “displays correctly”.
- Test Plan presence: `## Test Plan` is present.
- Test Plan cardinality: 5 Completion Criteria items match 5 Test Plan rows (`TC-01`–`TC-05`).
- Test Plan detail: every row has a non-empty Test Type and Tool / Approach and contains no `TBD`.
- Manual-test justification: N/A — no Test Plan row uses `manual`.
- Tasks structure: `## Tasks` contains the required not-yet-created task placeholder.
- Evidence structure: `## Evidence Log` was empty before this first GATE-WRITE run.
- Forbidden body sections: no `## Status` or `## Classification` section is present.
