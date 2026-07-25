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

## Slice 2 — finish `js/insecure-temporary-file` (2026-07-25)

Slice 1's analysis was used as-is; nothing was re-derived. Scope: the remaining **88** alerts in
`agent-framework` (76) and `agent-cli` (12).

### Converted in this slice (88 alerts owned)

Mechanical by pattern, exactly as slice 1 prescribed — **no shared helper, no new dependency**:
`join(tmpdir(), <fixed name>)` → `mkdtempSync(join(tmpdir(), 'prefix-'))`, using Node's own
`mkdtempSync` already available from `node:fs` in each file.

| Package           | Alerts | Sites converted | Files |
| ----------------- | ------ | --------------- | ----- |
| `agent-framework` | 76     | 29              | 27    |
| `agent-cli`       | 12     | 6               | 6     |

The sweep converted **every** `join(tmpdir(), …)` site in both packages, not only the lines CodeQL
had completed a flow for. The unflagged ones are the same defect with a flow the scanner did not
finish; leaving them would also have left the grep floor unenforceable.

All four flagged **production** lines (`update-check.ts:92`, `memory/project-memory-store.ts:182`,
`config/settings-io.ts:44`, `adapters/node-file-system.ts:38`) are class B exactly as slice 1
predicted — each takes a **caller-supplied** path and none constructs a path under `os.tmpdir()`.
Three were left alone deliberately: `node-file-system.ts` is the generic `IFileSystem` adapter the
agent's Write tool uses for ordinary project files (forcing `0600` there would be wrong),
`project-memory-store.ts` writes repo-tracked memory markdown meant to be shared, and
`update-check.ts` caches a version string. Adding a mode to those would be scanner appeasement.

### Real hardening found by the sweep — plaintext API key in settings

Running the converted `agent-cli` suite surfaced this on stderr:

> `API key stored as plain text in settings. Use --api-key-env for better security.`

`command-api/provider/provider-settings.ts` does persist `provider.apiKey` verbatim when a profile
is configured without `--api-key-env`, and `writeSettings` (`config/settings-io.ts:44`) wrote that
file with no `mode` — measured `0o664` on this host, i.e. **a credential readable by every user on
the machine**. This is the same class of real exposure slice 1 fixed for session/prompt content, so
it was hardened rather than dismissed: settings files are now created `0o600`, proven by a
red-first test (`expect(statSync(path).mode & 0o777).toBe(0o600)` — failed at `436` = `0o664`
before the fix). `mode` applies at creation only, so a pre-existing settings file keeps its mode;
that residual is recorded in the changeset.

### Grep floor

Slice 1's `dag-cli` floor was mirrored into both packages —
`packages/agent-framework/src/__tests__/no-insecure-temp-path.test.ts` and
`packages/agent-cli/src/__tests__/no-insecure-temp-path.test.ts`. Proven red before the sweep
(28 offenders in `agent-framework`, 6 in `agent-cli`) and green after. The repo-wide promotion
under `scripts/harness/` recorded in slice 1's follow-up is still open — three package-local floors
now exist and should collapse into one scan.

### Adjacent alerts

Slice 1's diff-scoped-gate warning was borne out, in miniature. Adding `mkdtempSync` to the `node:fs`
import of `context/__tests__/context-loader-memory.test.ts` made the PR analysis report a
**pre-existing** `js/unused-local-variable` on line 1 (`Unused import writeFileSync`) — the import was
already dead before this slice, and only became visible because the diff touches that line. It is a
genuine (if trivial) defect, so the dead import was removed rather than dismissed. ESLint does not
catch this class in test files, which is why it survived.

`js/insecure-temporary-file` on the PR merge ref: **0**. Nothing was dismissed in either slice.

### Class state

`js/insecure-temporary-file` is **closed**: 21 (slice 1) + 88 (slice 2) = **109 of 109** alerts
fixed at the source. **Zero dismissals across both slices.** One caveat to verify once CodeQL
re-analyzes `develop`: `agent-command/src/memory/__tests__/memory-command-module.test.ts:12` still
uses the old pattern and imports `@robota-sdk/agent-framework`. It carries no alert of its own
today, which indicates CodeQL is not tracking taint across the package boundary — but if any
`agent-framework` production alert survives, that line is the cause. It is outside slice 2's
ownership and is a one-line conversion.

SEC-003 remains **open** for `js/polynomial-redos` (18, sibling-owned), the style classes, the
`js/file-system-race` class (16) slice 1 catalogued, and the advisory→required decision.

## Test Plan

Per fixed class: a red-first regression test where feasible (e.g. the temp-path helper's test proves
the generated path is unpredictable and the old pattern is gone via a grep floor). After the sweep,
`gh api …/code-scanning/alerts` shows zero open high-severity alerts, or each remaining one carries a
dismissal reason. `run-all-scans` + full suites green.
