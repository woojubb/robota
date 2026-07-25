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

SEC-003 stays **open**: `js/polynomial-redos` (18 — see its own slice below), the style classes, and
the advisory→required promotion decision are untouched.

## Slice — `js/polynomial-redos` (2026-07-25)

### Root cause — read from the query, not inferred

From `javascript/ql/src/Performance/PolynomialReDoS.ql` +
`javascript/ql/lib/semmle/javascript/security/regexp/PolynomialReDoSCustomizations.qll`:

| Element        | Definition                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**     | an `Http::RequestInputAccess` (kind = the request-part name), **or** `Exports::getALibraryInputParameter()` — a parameter of a function the package exports (kind = `"library"`) |
| **Sink**       | a string flowing into `match`/`split`/`matchAll`/`replace`/`replaceAll`/`search` (arg 0) or `test`/`exec` (receiver) whose regex contains a `PolynomialBackTrackingTerm`         |
| **Sanitizers** | a global `String.replace` with a non-char-class regex; `substring`/`slice` with ≥2 args; and a `LengthGuard` — **any relational comparison on `.length`**                        |

Two facts that shaped the triage:

1. **All 18 alerts say "depends on library input"** — i.e. every one is source-kind `"library"`, not
   an HTTP request. CodeQL is claiming "a consumer of this package can pass a hostile string to this
   exported function", not that a network attacker can. Reachability therefore had to be established
   by reading the actual call path, which is exactly where the alerts differ from one another.
2. **The superlinearity itself is not a guess.** `PolynomialBackTrackingTerm` comes from CodeQL's NFA
   analysis, and the alert message names the pump string. Every one reproduced: measured below.
3. A `.length` check **is** a real sanitizer for this rule, and for polynomial (not exponential)
   ReDoS a length cap genuinely does bound the work. It was still not used anywhere here — every
   regex could be made linear without changing which inputs are accepted, which is strictly better
   than capping input the parsers are otherwise happy to take.

### Per-alert verdict (8 owned of 18)

Timings are `n = 200_000` unless noted, measured on this host, before → after.

| Alert | File:line                                               | Reachable?                    | Evidence                                                                                                                                             | Action                                                     |
| ----- | ------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 35    | `agent-command/src/schedule/schedule-spec-parser.ts:53` | **yes — model-composed**      | `createScheduleSystemCommand` declares `modelInvocable: true` (`schedule-command-module.ts`), so `/schedule`'s arg string is written by the model    | fixed: `\s+(.+)$` → `\s+(\S.*)$`; 14.8s → <1ms             |
| 36    | `agent-command/src/schedule/schedule-command.ts:117`    | **yes — model-composed**      | same, `createMonitorSystemCommand` (`/monitor`)                                                                                                      | fixed: same shape; 14.6s → <1ms                            |
| 37    | `agent-core/src/schema/structured-output.ts:222`        | **yes — raw model output**    | `parseStructuredResponseText(text)` is called on the model's final text in the structured-output retry loop; provider responses are not trusted data | fixed: `\s*\n` → `[^\S\n]*\n`; 12.7s → 1ms                 |
| 48,49 | `dag-cli/src/commands/convert.ts:150,154`               | **yes — caller-supplied doc** | `convertCommand` feeds `convertMermaid` from `--input`, a positional file path, or **stdin**; `from-mermaid.ts` also calls it on file content        | fixed: dropped the redundant leading `\s*`; 30.1s → <1ms   |
| 50    | `dag-cli/src/pipeline-parser.ts:129`                    | **yes — CLI arg**             | `parsePipelineSpec(spec)` is the `--pipeline` value, reached from `pipe.ts`, `save.ts`, `aav.ts`, `run.ts`                                           | fixed: `.split(/\s*\|\s*/)` → `.split('\|')`; 16.4s → <1ms |
| 44    | `agent-playground/.../agent-config-parser.ts:17`        | **yes — published export**    | `parseAgentConfig(code)` is exported from `@robota-sdk/agent-playground` and takes arbitrary source text; in-app it is the editor buffer             | fixed: `[^\]]+` → `[^\][]+`; 9.3s → 1ms                    |
| 45    | `agent-playground/.../agent-config-parser.ts:19`        | **yes — published export**    | same call, on the tools-array body                                                                                                                   | fixed: `\w+Tool` → `\b\w+Tool`; 17.2s → <1ms               |

**Dismissed: none.** Every owned alert had an input path that is not a repo-internal constant, so
none qualified for a dismissal-with-reason. Nothing was mass-dismissed.

### Why each fix is not a length cap

Each is a shape change that removes an ambiguity, and each was checked to accept exactly the same
inputs and produce the same captures (a differential check over well-formed, edge, and CRLF cases;
the equivalence tests are committed alongside the timing tests):

- `\s+(.+)$` → `\s+(\S.*)$` — the split between `\s+` and `.` was ambiguous because `.` also matches
  a space. Requiring a non-space first character pins it. Greedy `\s+` already consumed every leading
  space, so the accepted set is unchanged.
- `\s*\n` → `[^\S\n]*\n` — `\s` includes `\n`, so the run and the terminator overlapped. Restricting
  the run to horizontal whitespace makes the newline position unique. `\r` is still accepted (CRLF).
- leading `\s*` in `/\s*-->…/` and `/\s*\|\s*/` — **redundant**, because both call sites trim every
  part after splitting. Removing it means a failed attempt costs O(1) instead of O(n).
- `[^\]]+` → `[^\][]+` — stops the scan at the next bracket instead of at end-of-input, so repeated
  unterminated `tools:[` no longer rescans the whole buffer each time. A tools array never nests `[`.
- `\w+Tool` → `\b\w+Tool` — the `\b` is semantically free: any `\w+Tool` match can be extended left to
  a word boundary, so the match set is identical, but only boundary offsets start a scan.

### Adjacent finding — same class, NOT reported by CodeQL

`dag-cli/src/commands/from-mermaid.ts:43`, `MERMAID_BLOCK_RE`, had the same
whitespace-run-overlapping-a-lazy-body shape and is quadratic (3.4s on a 400 KB markdown file with an
unterminated ` ```mermaid ` fence). CodeQL did not report it — no library-input flow was proven into
that file — so the alert list is a floor, not the full inventory of this class. Fixed with the same
reasoning (the leading `\s*` was redundant; the capture is trimmed).

This is the mirror of slice 1's diff-scoped-gate lesson: slice 1 found the gate reports _pre-existing_
alerts on touched lines as new; this slice found the converse, that the gate misses same-class defects
it never had a source for. Neither the alert list nor the gate is a complete inventory.

### Red-first evidence

Every fix has a committed timing test that fails before it. Measured with the source reverted
(`git stash` of the source files only, tests left in place):

| Test                                                         | Pre-fix   | Post-fix |
| ------------------------------------------------------------ | --------- | -------- |
| `schedule-redos.test.ts` — pumped `cron` spec                | 14 761 ms | <1 ms    |
| `schedule-redos.test.ts` — pumped `/monitor` args            | 14 611 ms | <1 ms    |
| `structured-output.test.ts` — unterminated fence             | 12 702 ms | ~1 ms    |
| `convert-command.test.ts` — arrow-less line                  | 30 067 ms | <1 ms    |
| `pipeline-parser.test.ts` — whitespace-only `--pipeline`     | 16 381 ms | <1 ms    |
| `code-analyzer.test.ts` — repeated unterminated `tools:[`    | 9 276 ms  | ~1 ms    |
| `code-analyzer.test.ts` — long word-run inside a tools array | 17 238 ms | <1 ms    |
| `from-mermaid-command.test.ts` — unterminated ` ```mermaid ` | 3 365 ms  | ~1 ms    |

Each asserts `< 250 ms`, so the margin over the pre-fix time is 13×–120× and over the post-fix time
is >250×; these are not tight thresholds. Each fix also ships an equivalence test pinning the parse
result for well-formed input, so the regex shape cannot be loosened back.

### The diff-scoped gate fired — `js/bad-tag-filter`, and it was a false positive

Slice 1 predicted the gate would surface a **pre-existing** alert on a touched line. This slice hit
the other variant: the gate reported **two genuinely new** alerts (`js/bad-tag-filter`, high) caused
by the fix itself. Simplifying the mermaid arrow regex to `-->(?:\|[^|]*\|)?` made it match the
probe strings that query uses.

Read from `shared/regex/codeql/regex/nfa/BadTagFilterQuery.qll`, the rule is purely syntactic: an
`HtmlMatchingRegExp` is any regex that matches the literals `<!-- foo -->`, `<!-- foo --!>`,
`<foo>`, `<script>` …, and `isBadRegexpFilter` then compares **which capture groups fill** for each.
It never asks whether the code is parsing HTML. An unanchored pattern that tokenizes a bare `-->`
matches inside `<!-- foo -->`, so it is flagged. `convert.ts` parses mermaid edges and never sees a
tag — a false positive. The pre-branch regex escaped only incidentally: its `\s*-->[|][^|]*[|]\s*`
alternative required a `|` immediately after the arrow.

Resolved by **removing the regex**, not by dismissing: `splitByArrows` is now an `indexOf` scan.
That is linear by construction rather than by argument about backtracking, and it drops the
regex-engine surface that produced both this alert and the original ReDoS one. Verified equivalent
to the **original pre-branch** regex across 23 cases (unclosed `|`, doubled `||`, a label containing
`|`, bare/chained/adjacent arrows, empty segments), and linear at 200 K characters.

**Generalisable lesson:** a ReDoS fix that _simplifies_ a regex can move it into another regex
query's probe set. Re-read the PR gate after the fix — the diff-scoped gate is noisy in both
directions (slice 1: reports old alerts as new; this slice: the fix creates a real new one), and
neither direction can be assumed away.

### Also closed here — the last `join(tmpdir(), <fixed>)` in `agent-command`

`packages/agent-command/src/memory/__tests__/memory-command-module.test.ts:12`, left behind by slice
2 because this package belonged to another wave. It carried no alert of its own (CodeQL did not
track the taint across the package boundary) but imports `@robota-sdk/agent-framework`, making it
the remaining candidate cause for any `agent-framework` production alert that survives re-analysis.
Converted to `mkdtempSync(join(tmpdir(), 'robota-command-memory-'))` per slice 2's rule of converting
**every** such site rather than only those CodeQL completed a flow for, so the grep floor stays
enforceable. It was the only such site in `agent-command`; the other four already used `mkdtemp`.

### Remaining `js/polynomial-redos` — 10 alerts, sibling/other-owner packages

Not touched here (outside this slice's file ownership). All are the same three shapes — an unanchored
leading `\s*`/`\w+`/`[^x]+` run, or a `\s`-vs-`\n` overlap — and none of them has an HTTP source
either, so the same reachability question (who supplies the string?) has to be answered per site:

| Alert | File:line                                                               |
| ----- | ----------------------------------------------------------------------- |
| 34    | `agent-cli/src/subagents/git-worktree-isolation-adapter.ts:139`         |
| 38    | `agent-framework/src/command-api/provider/provider-profile-names.ts:30` |
| 39    | `agent-framework/src/commands/skill-source.ts:35`                       |
| 40    | `agent-framework/src/context/task-context.ts:136`                       |
| 41    | `agent-framework/src/memory/project-memory-store.ts:83`                 |
| 42    | `agent-framework/src/tools/model-command-tool-projection.ts:56`         |
| 43    | `agent-framework/src/update-check/update-check.ts:279`                  |
| 46    | `agent-remote-pairing/src/pairing.ts:95`                                |
| 47    | `agent-tools/src/sandbox/workspace-manifest.ts:204`                     |
| 51    | `dag-framework/src/http-dag-runtime-provider.ts:121`                    |

Alert 46 (`pairing.ts`, pump `a=fingerprint:`) is worth prioritising: SDP text arrives over the
signalling channel, so unlike the rest it plausibly has a genuine remote source.

SEC-003 stays **open**: those 10 alerts, the style classes, and the advisory→required promotion
decision remain.

## Test Plan

Per fixed class: a red-first regression test where feasible (e.g. the temp-path helper's test proves
the generated path is unpredictable and the old pattern is gone via a grep floor). After the sweep,
`gh api …/code-scanning/alerts` shows zero open high-severity alerts, or each remaining one carries a
dismissal reason. `run-all-scans` + full suites green.
