---
title: 'SEC-003: triage ~170 open CodeQL alerts (109 high-severity) accumulated behind an advisory gate'
status: superseded
created: 2026-07-25
completed: 2026-07-26
priority: high
urgency: soon
area: packages, scripts
depends_on: []
---

# SEC-003: CodeQL alert backlog triage

## Superseded (2026-07-26) — every stated remainder now has a different owner

Both classes this item OPENED with are closed at the source with zero dismissals:
`js/insecure-temporary-file` 109/109 (slices 1+2) and `js/polynomial-redos` 18/18 (slices 3+4).
Neither appears in the paginated `develop` alert list today — `js/polynomial-redos` is gone entirely,
and the 7 remaining `js/insecure-temporary-file` alerts are a DIFFERENT site set, triaged as false
positives in `SEC-006`'s verdict table (they resolve under a caller-supplied `cwd`, never `os.tmpdir()`).

The three things this item's later slices kept it open for have each moved to a live owner, so it is
closed as superseded rather than done — the classes it opened with are finished, but the residue is
not its work any more:

| Stated remainder                      | Owner now                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/file-system-race` (16 catalogued) | `SEC-006` triaged the whole class (alerts #57–#72): 8 FP with the CWE-367 premise stated, 1 fixed (`host-identity.ts`), 1 NF, 4 `scripts/**` OOS |
| style classes (~130)                  | `SEC-005` — [#1443](https://github.com/woojubb/robota/pull/1443) closed 87 `js/unused-local-variable` alerts at the source; 14 notes remain      |
| advisory→required promotion decision  | `INFRA-048` (the `review-gate` check + its ruleset preconditions) and `INFRA-046` (advisory→required criteria) — not a CodeQL-triage decision    |

**Two follow-ups this item opened had NO other owner, and have been moved to `SEC-007`'s
`## Carried onward` list** (the live tail of the SEC chain) rather than being archived with it:

1. Promote the three package-local `no-insecure-temp-path.test.ts` grep floors
   (`packages/dag-cli/src/utils/__tests__/`, `packages/agent-framework/src/__tests__/`,
   `packages/agent-cli/src/__tests__/`) into one repo-wide scan under `scripts/harness/`.
2. `extractDtlsFingerprint` should bind the fingerprint the DTLS stack verified, not the first
   `a=fingerprint` line in the SDP (`packages/agent-remote-pairing/src/pairing.ts`). Needs an owner
   call and a real two-peer run.

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

### Slice 4 — the remaining 10 (2026-07-25)

The methodology above was reused as-is; nothing was re-derived. Scope: the 10 alerts the previous
slice could not touch, plus the same-shape sweep of the five packages they live in.

#### Alert 46 confirmed remote-reachable, pre-authentication — and it was binding free text

The prioritisation was right, and the finding is larger than DoS. Two call paths, both citing the
remote SDP:

| Peer                 | Path                                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host (Node, offerer) | `WsSignalingClient` → relay `signal` frame → `WebRtcTransport.start`'s `onSignal` handler (`webrtc-transport.ts:125-138`) → `startPairingIfConfigured(…, message.data)` → `extractDtlsFingerprint(sdp)` at `webrtc-transport.ts:172`, whose result is `PairingGate`'s `remoteFingerprint` |
| Browser (answerer)   | `RtcSignaling` → `handleOffer(offer)` (`rtc-session-client.ts:265`) → `extractDtlsFingerprint(offer.sdp ?? '')` at line 267 — the **first** statement, before `setRemoteDescription`                                                                                                      |

The relay (`apps/remote-signaling/src/relay.ts`) is content-blind and forwards `offer`/`answer`/`ice`
payloads verbatim; its only auth seam, `onJoinAttempt`, is optional and unset by default. The pairing
module's own header states the threat model — a relay that substitutes a DTLS fingerprint must be
detected — so the SDP is attacker-controlled **by design**. And the extraction is necessarily the
first thing that happens: it produces the value the confirmation binds, so nothing can gate it.

That makes this a genuine **pre-authentication remote** vector, not a library-input one:

- **DoS.** 400 KB of `a=fingerprint:` blocked the event loop for 5.0 s. The relay's own
  `maxFrameBytes` (64 KB) is not a bound — the threat model's attacker is the relay.
- **Channel-binding surface (the bigger half).** The regex was unanchored, so it returned the first
  `a=fingerprint:` **substring**, including one sitting inside another line's free text. Proven in
  `pairing-redos.test.ts`: for `s=room a=fingerprint:sha-256 DE:AD:BE:EF\r\na=fingerprint:sha-256 AB:CD:EF`
  the pre-fix code returned `DE:AD:BE:EF` — the smuggled value — while every DTLS stack negotiates
  against the real attribute. A relay could therefore choose each peer's `remoteFingerprint`
  independently of the certificate it actually terminates, which is exactly what the directional HMAC
  confirmation exists to prevent.

Fixed by anchoring to the start of an SDP line: `/^a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/m`. Linear
(line starts are the only start offsets, and their costs sum to the input length) and structurally
correct (`<type>=<value>` is the SDP line grammar; a mid-line occurrence is not an attribute). The
real two-peer werift suite (`agent-transport-webrtc`, 29 tests including `pairing-e2e` and
`dtls-fingerprint-binding`) passes unchanged.

**Residual, deliberately not fixed here:** it still returns the FIRST fingerprint line, not the one
the DTLS stack verified for the negotiated m-section, so a relay-inserted **session-level** line can
still shadow a media-level one. Closing that needs structural SDP parsing or a fail-closed check that
all fingerprint lines agree — a behaviour change to the live WebRTC path that this slice did not want
to make on a regex ticket. **Recorded as a follow-up for owner visibility (see below).**

#### Per-alert verdict (10 of 10)

Pumps are `n = 200_000` (`n = 400_000` for alert 46), measured on this host through the **exported
entry point** named in each row — no private function was imported.

| Alert | File:line                                                               | Reachable?                        | Evidence (call path / input source)                                                                                                                | Action                                                     | Red → green      |
| ----- | ----------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- |
| 46    | `agent-remote-pairing/src/pairing.ts:95`                                | **yes — REMOTE, pre-auth**        | signaling relay → `webrtc-transport.ts:172` / `rtc-session-client.ts:267`, before any confirmation (table above)                                   | fixed: anchored `/^…/m`                                    | 5 040 ms → <1 ms |
| 41    | `agent-framework/src/memory/project-memory-store.ts:83`                 | **yes — model/user topic string** | `ProjectMemoryStore.readTopic`/`append` take the topic verbatim; `-` is inside the KEPT class, so the collapse does not shorten a dash run         | fixed: `trimEdgeChars`                                     | 11 842 ms → 1 ms |
| 43    | `agent-framework/src/update-check/update-check.ts:279`                  | **yes — public option**           | `checkForCliUpdate({ registryUrl })` → `buildPackageMetadataUrl`                                                                                   | fixed: `trimTrailingChars`                                 | 11 872 ms → 1 ms |
| 39    | `agent-framework/src/commands/skill-source.ts:35`                       | **yes — on-disk skill file**      | `parseFrontmatter` ← `scanSkillsDir` over `.claude/skills`, `.agents/skills`, `~/.robota/skills` — content the agent itself writes and installs    | fixed: split on `','`                                      | 12 619 ms → 1 ms |
| 40    | `agent-framework/src/context/task-context.ts:136`                       | **yes — `.git` file content**     | `readCurrentGitBranch(cwd)` → `resolveGitDirectory` reads a `.git` **file** and matches `/^gitdir:\s*(.+)$/`                                       | fixed: `(\S.*)`                                            | 14 489 ms → 1 ms |
| 34    | `agent-cli/src/subagents/git-worktree-isolation-adapter.ts:139`         | **yes — public options/request**  | `prepare({ jobId })` and the `idFactory` option both flow into `sanitizePathSegment`; `-` is inside the KEPT class                                 | fixed: local `trimDashes`                                  | 11 836 ms → 1 ms |
| 47    | `agent-tools/src/sandbox/workspace-manifest.ts:204`                     | **yes — public option**           | `applyWorkspaceManifest(client, manifest, { targetRoot })` → `normalizeSandboxRoot`; the backslash conversion manufactures the run                 | fixed: local `trimTrailingSlashes`                         | 12 037 ms → 1 ms |
| 51    | `dag-framework/src/http-dag-runtime-provider.ts:121`                    | **yes — public constructor arg**  | `new HttpDagRuntimeProvider({ baseUrl })`                                                                                                          | fixed: local `trimTrailingSlashes`                         | 11 965 ms → 1 ms |
| 38    | `agent-framework/src/command-api/provider/provider-profile-names.ts:30` | reachable, **not exploitable**    | `sanitizeProviderProfileName(value)` is exported, but the preceding `replace(/[^a-z0-9]+/g, '-')` collapses every run, so `-+$` can match one char | fixed anyway: `trimEdgeChars`                              | 0 ms (see below) |
| 42    | `agent-framework/src/tools/model-command-tool-projection.ts:56`         | reachable, **not exploitable**    | same shape; `replace(/_+/g, '_')` collapses the underscore run first                                                                               | fixed anyway: `trimEdgeChars` + `trimTrailingChars` at :85 | 1 ms (see below) |

**Dismissed: none — 10 of 10 fixed at the source.** Zero dismissals across all four slices.

Alerts 38 and 42 deserve the honest note: their timing tests are **green against the pre-fix source**,
because a collapse earlier in the same expression makes the quadratic term unreachable. They were not
dismissed, because 41 and 34 are literally the same three-line pattern with `-` moved into the kept
class — the shape is one character-class edit away from live, and 34 proves that edit gets made. They
are fixed and their tests stand as equivalence pins rather than timing floors.

#### Sweep — same shapes, no CodeQL alert

The previous slice's "the alert list is a floor" lesson held again. Sweeping the five owned packages
for the three shapes (trailing-run trim, `\s*<lit>\s*` split, `\s`/`.` overlap) found four more, one
of which is the most severe defect in this slice:

| Site                                                            | Shape                                    | Measured  | Verdict                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `agent-tools/src/builtins/web-fetch-tool.ts:29-31`              | `<[^>]+>`, `<script[\s\S]*?</script>`, … | 12 635 ms | **fixed — input is a live response body from an arbitrary URL**, capped only at 5 MB (≈ hours)        |
| `agent-framework/src/agents/agent-definition-loader.ts:26`      | `/\s*,\s*/` — a literal copy of alert 39 | 12 635 ms | fixed identically                                                                                     |
| `agent-framework/src/context/task-context.ts:88`                | `\s+(.+)$` on a task-file line           | 15 385 ms | fixed — a lone `\r` survives the `/\r?\n/` split, so a "line" can hold a run that never reaches `$`   |
| `agent-framework/src/tools/model-command-tool-projection.ts:85` | `[_-]+$`                                 | 0 ms      | bounded by `slice(0, ≤64)` three statements earlier — converted anyway rather than left resting on it |

Measured and cleared (no change made): `task-context.ts:61` `extractMetadata` (the `m` flag lets `$`
match at end-of-line, so it succeeds immediately — 0.2 ms), `memory-candidate-extractor.ts:40-43`
(no `$` anchor, so the capture succeeds on its first character — 0.2 ms), `skill-prompt.ts:62`
(3.6 ms), and every `^…` leading-run trim (a start anchor gives one start offset).

`web-fetch-tool.ts` is the sharpest illustration of why the sweep is mandatory: CodeQL flagged eight
`agent-framework` sanitisers whose worst input is a config string, and did not flag the one function
in these five packages that parses **HTML fetched from an arbitrary URL**.

#### Why these fixes are index scans, not cleverer regexes

A lookbehind guard (`/(?<!-)-+$/`) was measured and is equally linear (1.1 ms vs 52 s at 400 K) and
exhaustively equivalent. It was **rejected**: CodeQL's `PolynomialBackTrackingTerm` is an NFA property
of the regex, and whether it models a lookbehind's pruning of start offsets is not something this
slice could verify before merge (a PR's diff-scoped analysis only reports NEW alerts, so it cannot
confirm an old one cleared). An index scan removes the regex, and the rule cannot flag what is not
there. This is the same reasoning the previous slice used when its simplified arrow regex tripped
`js/bad-tag-filter` and it deleted the regex instead of dismissing.

Each replacement was proven equivalent to the regex it replaced by exhaustive comparison, not by
example — every string over the relevant alphabet up to length 12 (`trim-char.test.ts`: `^-+|-+$`,
`^_+|_+$`, `\/+$`, `[_-]+$`), ~12 M strings for the `<script>` stripper, ~800 K for the tag stripper,
and 349 526 trimmed inputs for `gitdir:`. Those comparisons are committed, so the shapes cannot be
loosened back silently.

#### Red-first evidence

Measured by stashing the **source** files only and re-running the committed tests, so every red is an
assertion failure carrying its own elapsed time, not a timeout.

| Test                                                                | Pre-fix                | Post-fix           |
| ------------------------------------------------------------------- | ---------------------- | ------------------ |
| `pairing-redos` — one-line `a=fingerprint:` pump                    | 5 040 ms               | <1 ms              |
| `pairing-redos` — pump inside an `s=` line's free text              | 5 060 ms               | <1 ms              |
| `pairing-redos` — smuggled fingerprint is not returned              | returned `DE:AD:BE:EF` | returns `AB:CD:EF` |
| `polynomial-redos` (fw) — `ProjectMemoryStore.readTopic` dash run   | 11 842 ms              | <1 ms              |
| `polynomial-redos` (fw) — `checkForCliUpdate` registry slash run    | 11 872 ms              | <1 ms              |
| `polynomial-redos` (fw) — skill frontmatter list, whitespace run    | 12 619 ms              | <1 ms              |
| `polynomial-redos` (fw) — agent-definition list (unflagged twin)    | 12 635 ms              | <1 ms              |
| `polynomial-redos` (fw) — `readCurrentGitBranch` `gitdir:` run      | 14 489 ms              | <1 ms              |
| `polynomial-redos` (fw) — task open items, CR-only line (unflagged) | 15 385 ms              | <1 ms              |
| `git-worktree-isolation-redos` — `prepare()` delta over baseline    | 11 836 ms              | <1 ms              |
| `polynomial-redos` (tools) — `applyWorkspaceManifest` targetRoot    | 12 037 ms              | <1 ms              |
| `polynomial-redos` (tools) — `WebFetch` unclosed `<` (unflagged)    | 12 635 ms              | ~5 ms              |
| `polynomial-redos` (tools) — `WebFetch` unclosed `<script`          | 2 662 ms               | ~2 ms              |
| `http-dag-runtime-provider-redos` — `baseUrl` slash run             | 11 965 ms              | <1 ms              |

Every timing test asserts `< 250 ms`, so the margin over the pre-fix time is 10×–60× and over the
post-fix time is >50×. The `agent-cli` case asserts the **delta** against an identical `prepare()` run
with a short id, because `git init` + `worktree add` dominate that call and vary by filesystem.

The 14 equivalence tests all pass against the **pre-fix** source as well — that is what makes them
pins rather than restatements of the new behaviour. The two exceptions are the `pairing` smuggling
tests, which are red pre-fix by design: they assert the deliberate behaviour change.

#### Class state

`js/polynomial-redos` is **closed**: 8 (slice 3) + 10 (slice 4) = **18 of 18** fixed at the source,
plus 5 same-shape defects CodeQL never reported (1 in slice 3, 4 here). **Zero dismissals in any
slice of SEC-003.**

#### Follow-up opened by this slice

**`extractDtlsFingerprint` should bind the fingerprint the DTLS stack verified, not the first one in
the SDP.** Anchoring closed free-text smuggling, but a relay can still add a session-level
`a=fingerprint` line that a media-level line overrides for the actual DTLS association — the extractor
would bind the shadowed value. Two candidate fixes, both a behaviour change to the live WebRTC path:
fail closed when the SDP carries more than one distinct fingerprint value (RFC 8122 + BUNDLE make a
single value the norm; both committed fixtures satisfy it), or parse the m-section structurally. This
needs owner sign-off and a real two-peer run, so it is **not** in this slice.

SEC-003 remains **open** for `js/file-system-race` (16), the style classes (~130), and the
advisory→required promotion decision. Both high-severity classes it opened with are now closed.

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
