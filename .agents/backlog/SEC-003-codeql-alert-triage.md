---
title: 'SEC-003: triage ~170 open CodeQL alerts (109 high-severity) accumulated behind an advisory gate'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: packages, scripts
depends_on: []
---

# SEC-003: CodeQL alert backlog triage

## Problem

CodeQL runs on every push/PR but is **advisory** (not a required check), so its findings were never
triaged and have accumulated. Current open alerts on `develop` (measured 2026-07-25 via
`gh api repos/woojubb/robota/code-scanning/alerts --paginate`):

| Rule                                       | Open | Severity   |
| ------------------------------------------ | ---- | ---------- |
| `js/insecure-temporary-file`               | ~109 | **high**   |
| `js/polynomial-redos`                      | 18   | high       |
| `js/comparison-between-incompatible-types` | 5    | —          |
| `js/regex/duplicate-in-character-class`    | 4    | —          |
| `js/unused-local-variable` etc.            | ~130 | style/none |

`js/insecure-temporary-file` concentrates in `packages/agent-framework` (~76), `packages/dag-cli`
(~18) and `packages/agent-cli` (~12). `js/polynomial-redos` hits real parsing code:
`agent-command/src/schedule/schedule-spec-parser.ts`, `agent-core/src/schema/structured-output.ts`,
`agent-cli/src/subagents/git-worktree-isolation-adapter.ts`, `dag-cli/src/commands/convert.ts`,
`agent-playground/.../agent-config-parser.ts`.

A high-severity alert class this large sitting unreviewed is itself the defect — nobody has decided
whether each is real, and the volume now hides any NEW alert in the noise.

## What

1. **Triage by class, not by alert.** For `js/insecure-temporary-file`, determine the shared pattern
   (predictable path in the OS temp dir?) and decide once: fix at the source (a single safe
   temp-path helper — `mkdtemp`-based — that all sites adopt) or dismiss-with-reason where the write
   is provably not attacker-influenced. Do NOT click through ~109 alerts individually.
2. **`js/polynomial-redos`** — assess each regex for real super-linear backtracking on
   attacker-reachable input; fix the reachable ones (bounded quantifiers / anchored alternatives) and
   dismiss the unreachable with a recorded reason.
3. **Style-class alerts** (`js/unused-local-variable`, …): decide policy — either fix in a sweep or
   tune the CodeQL query set so they stop competing with security findings for attention.
4. **Close the loop mechanically**: once the backlog is at zero-or-explained, decide whether CodeQL
   (or at least its `security-severity: high` subset) becomes a REQUIRED check so this cannot silently
   re-accumulate. Coordinate with INFRA-046 (advisory→required promotion criteria).

## Slice 1 — `js/insecure-temporary-file` class analysis (2026-07-25)

### Root cause — read from the query, not inferred

The rule is **not** about predictable filenames. Read from
`javascript/ql/lib/semmle/javascript/security/dataflow/InsecureTemporaryFileCustomizations.qll`:

| Element       | Definition                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**    | an `os.tmpdir()` call, **or any string literal matching `/tmp/%`**                                                                                                                |
| **Sink**      | the path argument of `fs` `open`/`writeFile`/`writeJson`/`outputFile`(+`Sync`) where **no `mode` is passed**, or the mode's low 6 bits are not all zero (i.e. not `0o600`-shaped) |
| **Sanitizer** | a non-first leaf of a string concatenation, or argument index ≥ 1 of `path.join`                                                                                                  |

So an alert means: _a temp-dir-derived path reaches a file write that does not restrict permissions._
Two corroborating facts settled it — `dag-cli/src/commands/node.ts` already used `randomUUID()` for
the filename and was **still** flagged (so name randomness is irrelevant), and measured on this host
`os.tmpdir()` is mode `0777`, a file joined directly into it lands at `0664` (world-readable), while
`mkdtemp` yields a `0700` directory.

`mkdtemp` clears the flow because taint stops at its **return value** (CodeQL models no
argument→return step through it) — not because it is a declared sanitizer. That distinction matters:
the fix works and is also the genuinely correct CWE-377 mitigation (a private directory defeats the
symlink pre-creation attack, which `mode: 0600` alone does not).

### The class splits in two

- **A — real production temp writes** (the code itself builds a path under `os.tmpdir()`): only
  **2 sites repo-wide**, both in `dag-cli` (`commands/node.ts`, `commands/template.ts`).
- **B — test-supplied taint** (production code writes into a _caller-supplied_ directory; the only
  temp source is a test passing `join(tmpdir(), fixed)` or a `'/tmp/…'` literal). This is the
  overwhelming majority — including all 4 flagged production lines in `agent-framework`. Fixing the
  **test** clears the alert on the production file too, since it is one flow.

Of all 109 alerts, 84 of the sibling's 88 are literally in `__tests__` files.

### Helper home + rationale

`withTempWorkspace(prefix, fn)` → **`packages/dag-cli/src/utils/temp-workspace.ts`** (module-local).

Rejected alternatives, with reasons:

- **`packages/agent-process`** — its own SPEC forbids it in three places: "deliberately NOT a
  catch-all for process utilities", "only OS process termination", "Process-tree termination only".
  A filesystem primitive there would violate the package's written charter.
- **`packages/agent-testing`** — `"private": true`, devDependency-only test harness. `dag-cli`'s
  **production** code needs this at runtime; a shipped package cannot depend on a private test package.
- **A new published leaf** (e.g. `agent-tempdir`) — the installability driver in
  `project-structure.md` does not justify a package for one ~15-line function with **2 production
  call sites in a single package**.
- **A shared cross-package helper at all** — unnecessary once the A/B split is known. Test sites need
  only Node's own `mkdtemp`, which is already the established alert-free idiom in this repo
  (`localnode-e2e.test.ts`, `run-draft-store.test.ts`, `session-artifact.test.ts`). Wrapping a
  one-call stdlib API in a `@robota-sdk` package would be indirection with no payoff.

The sibling's sweep is therefore mechanical **by pattern**, not by import: convert
`join(tmpdir(), fixed)` → `mkdtemp(join(tmpdir(), 'prefix-'))` in tests, and add `mode: 0o600` to
production writes of sensitive content into caller-supplied dirs.

### Converted in this slice (21 alerts owned)

| Package                 | Alerts | Change                                                                                                                                  |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `dag-cli`               | 18     | new `withTempWorkspace`; `node.ts` + `template.ts` moved onto it; `build-command.test.ts` + `doctor-command.test.ts` moved to `mkdtemp` |
| `agent-provider-openai` | 1      | payload logs now `0600`, log dir `0700`; test fixture moved off a `/tmp/…` literal                                                      |
| `agent-session`         | 1      | session JSONL + externalized payloads now `0600`, dirs `0700`                                                                           |
| `dag-adapters-local`    | 1      | `cost-meta.json` now `0600`; test moved off the fixed `/tmp/robota-cost-meta-test` path                                                 |

**Dismissed via `gh api`: none.** Every owned alert was fixed at the source, so no dismissal
justifications were needed and nothing was mass-dismissed.

### Remaining sweep (sibling-owned, not touched here)

`agent-framework` **76** + `agent-cli` **12** = **88**. Breakdown: 84 in `__tests__` files; 4 in
production source (`update-check.ts`, `memory/project-memory-store.ts`, `config/settings-io.ts`,
`adapters/node-file-system.ts`) — all class B, so they clear when their tests are converted.

### Adjacent finding surfaced by the fix — `js/file-system-race`

Touching `session-logger.ts`'s payload write made CodeQL report a **pre-existing** `js/file-system-race`
alert (already open on develop at that file) as "new", because the PR gate is diff-scoped: it reports
any alert on a line the PR changes. The `existsSync`-then-`writeFileSync` pair was a genuine TOCTOU
race between concurrent sessions externalizing the same payload, so it was fixed rather than
dismissed — the write now uses the exclusive-create flag `wx`, and since the filename is the sha256 of
the content, `EEXIST` provably means identical bytes.

**Lesson for the sibling slice and any future sweep:** editing a line that already carries an unrelated
open alert will fail the CodeQL PR gate even though nothing regressed. Expect it, and fix the adjacent
finding rather than assuming the diff introduced it. `js/file-system-race` currently has **16** open
alerts repo-wide (`agent-framework` 3, `agent-cli` 3, `dag-cli` 1, `agent-session` 1 (now fixed),
`agent-tools` 1, `agent-command` 1, `agent-command-workflows` 1, plus 5 in `scripts/`) — a candidate
class for a later SEC-003 slice.

### Follow-up

The grep floor added here (`dag-cli/src/utils/__tests__/no-insecure-temp-path.test.ts`) is scoped to
`dag-cli` only. Once the sibling slice lands, promote it to a repo-wide mechanical scan under
`scripts/harness/` (out of this slice's ownership) so the pattern cannot re-enter any package.

SEC-003 stays **open**: `js/polynomial-redos` (18), the style classes, and the
advisory→required promotion decision are untouched.

## Test Plan

Per fixed class: a red-first regression test where feasible (e.g. the temp-path helper's test proves
the generated path is unpredictable and the old pattern is gone via a grep floor). After the sweep,
`gh api …/code-scanning/alerts` shows zero open high-severity alerts, or each remaining one carries a
dismissal reason. `run-all-scans` + full suites green.
