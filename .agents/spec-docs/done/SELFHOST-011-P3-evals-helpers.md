---
status: done
completed: 2026-07-19
type: BEHAVIOR
tags: [evals, sdk, agent-framework, neutral-helpers, selfhost]
---

# SELFHOST-011 P3: optional neutral eval metric helpers + dataset parser + SDK report formatter

## Problem

Promotes the deferred [SELFHOST-011 P3](../../backlog/SELFHOST-011-P3-P4-evals-followups.md). SELFHOST-011 P1/P2
shipped the neutral evals-as-code surface (`agent-framework/src/evals/`: `IMetric` type, `defineEval`/`runEval`,
`createSessionRunFn`) — but a first-time consumer must hand-write even trivial metrics (`response includes X`,
`matches regex`, `used tool Y`), re-parse a dataset file themselves, and re-implement report formatting (the
`robota eval` CLI has a PRIVATE `formatEvalReport`). This raises the floor to first value without adding any
opinionated/domain content. Per the epic's neutrality mandate, the helpers must be **mechanism-only** (the
consumer supplies the expected value / pattern / tool name = the content), so HARNESS-034 (evals-content
neutrality) stays satisfied.

## Prior Art Research

Waived: <the mechanism-vs-content boundary is already established by SELFHOST-011's Prior Art (Mastra ships
opinionated scorers = REJECTED; Robota ships neutral mechanism only). This slice adds pure mechanism helpers over
the SSOT `IExecutionResult`; no new external product prior art beyond the epic's.>

## Architecture Review

### Affected Scope

- **Contract fix (proposal-review REVISE→applied): thread the case into scoring so per-case `expected` is live.**
  Today `IEvalCase.expected` is DEAD — the runner calls `metric.score(result)` (result only), so no metric can
  read a case's expected value, and `parseEvalCases`' per-case `expected` cannot connect to `exactMatch`. Extend
  the P1 contract to `IMetric.score(result: IExecutionResult, evalCase?: IEvalCase): number | boolean`
  (backward-compatible — `evalCase` optional; existing `(result) => …` metrics still satisfy it), and have
  `runner.ts` pass the `evalCase` (`eval-types.ts` + `runner.ts`).
- `agent-framework/src/evals/metric-helpers.ts` (new) — pure `IMetric` factories: `exactMatch(expected?,{trim?})`
  (if `expected` given → homogeneous closure; else reads `evalCase.expected` → genuinely per-case, making the
  parser's field live), `includesText(substr)`, `regexMatch(pattern)`, `responseIsJson()`, `usedTool(name)` (over
  `toolSummaries`). Each is mechanism; the CONSUMER supplies the content. No opinionated metric set, no domain
  content.
- `agent-framework/src/evals/dataset.ts` (new) — pure `parseEvalCases(text, format: 'json'|'jsonl')`:
  `IEvalCase[]` (consumer supplies the corpus text; the library only parses the shape `{input, expected?}`). NO
  file I/O in the library (the surface reads bytes); no dataset content ships.
- `agent-framework/src/evals/format.ts` (new) — neutral `formatEvalReport(report): string` (mirrors the CLI's
  private formatter) so SDK consumers render a report identically.
- `agent-framework/src/evals/index.ts` + root barrel — export the helpers + parser + formatter.
- `agent-cli/src/eval/eval-command.ts` — REPLACE its private `formatEvalReport` with the SDK one (consolidate;
  the whole point — no duplicate formatter).

### Alternatives Considered

1. **Neutral mechanism helpers + pure parser + shared formatter in `agent-framework/src/evals/` (CHOSEN).**
   ✅ Raises the floor to first value; stays mechanism-only (consumer supplies content) so neutrality holds;
   consolidates the CLI's duplicate formatter. ❌ v1 helper set is small — but deliberately (more = opinion).
2. **Ship an opinionated metric set (faithfulness/toxicity, Mastra-style).** ❌ Domain content in `packages/` —
   the exact erosion HARNESS-034 fences + SELFHOST-011 Alternative-1 REJECTED. REJECTED.
3. **A dataset FILE loader (fs) in the library.** ❌ Couples the neutral library to disk + a path convention;
   the surface already owns file reading (agent-cli loads the definition). Keep the library pure (parse text).
   REJECTED — provide `parseEvalCases(text,...)`, not `loadEvalCasesFromFile(path)`.

### Decision

Adopt (1): pure mechanism metric helpers + a pure dataset-text parser + a neutral `formatEvalReport`, exported
from `agent-framework/src/evals/`; the CLI adopts the shared formatter (deleting its private copy). All helpers
are mechanism over the SSOT `IExecutionResult`; the consumer supplies every value = the content.

## Affected Files

| File                                                    | Change                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `agent-framework/src/evals/eval-types.ts` + `runner.ts` | extend `IMetric.score(result, evalCase?)` (backward-compat) + runner passes the case — makes `IEvalCase.expected` live |
| `agent-framework/src/evals/metric-helpers.ts` (new)     | pure `IMetric` factories (exactMatch/includesText/regexMatch/responseIsJson/usedTool)                                  |
| `agent-framework/src/evals/dataset.ts` (new)            | pure `parseEvalCases(text, format)`                                                                                    |
| `agent-framework/src/evals/format.ts` (new)             | neutral `formatEvalReport(report)`                                                                                     |
| `agent-framework/src/evals/index.ts` + `src/index.ts`   | export helpers + parser + formatter                                                                                    |
| `agent-cli/src/eval/eval-command.ts`                    | use the SDK `formatEvalReport` (delete the private copy)                                                               |
| SPEC.md (agent-framework)                               | note the neutral helpers under Evals                                                                                   |

## Completion Criteria

- [x] TC-01: each metric helper is a pure `IMetric` over `IExecutionResult` (mechanism only) — `includesText`/
      `regexMatch`/`responseIsJson`/`usedTool` return the right pass/fail for crafted results, and `exactMatch`
      works BOTH as a closure (`exactMatch('x')`) AND per-case (`exactMatch()` reading `evalCase.expected`) —
      the case is threaded into `score` so the parser's per-case `expected` is live (unit).
- [x] TC-02: `parseEvalCases(text,'json'|'jsonl')` parses a consumer corpus into `IEvalCase[]`; malformed input
      throws (unit); NO dataset content ships in `packages/` (the parser is mechanism).
- [x] TC-03: `formatEvalReport` renders per-case + overall pass/fail; the `robota eval` CLI uses it (no private
      duplicate) and its exit-code test stays green (unit + CLI regression).
- [x] TC-04: neutrality — `scan-agent-tools-neutrality`/HARNESS-034-style: the helpers add NO opinionated metric
      set / dataset content (review + the mechanism-only design); agent-framework 1214-test suite stays green.

## Test Plan

| TC    | Verification                                                  | Type/Tool                          |
| ----- | ------------------------------------------------------------- | ---------------------------------- |
| TC-01 | metric helpers pass/fail over synthetic IExecutionResult      | vitest unit                        |
| TC-02 | parseEvalCases json/jsonl + malformed throws                  | vitest unit                        |
| TC-03 | formatEvalReport render + CLI adopts it, exit-code test green | vitest unit + agent-cli regression |
| TC-04 | mechanism-only, no content; suite green                       | review + full test run             |

## Tasks

- **P1 (this)** — the helpers + parser + formatter + CLI adoption + exports + tests. Single-slice.

## Evidence Log

- 2026-07-19 — **Draft authored**, grounded in the shipped `agent-framework/src/evals/` surface (P1/P2:
  `eval-types.ts`/`runner.ts`/`session-run-fn.ts`), the CLI's private `formatEvalReport`
  (`agent-cli/src/eval/eval-command.ts`), and the epic's mechanism-vs-content neutrality mandate. Prior-art waived
  (extends SELFHOST-011's).

### [GATE-WRITE] — ✅ PASS | 2026-07-19

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags:` present (non-empty array). PASS.
- Problem: concrete symptom (first-time consumer must hand-write trivial metrics, re-parse datasets, re-implement report formatting; `robota eval` CLI has a PRIVATE `formatEvalReport`) + reproduction condition (consuming the P1/P2 neutral evals surface); no TBD/TODO. PASS.
- Prior Art Research: `## Prior Art Research` present with explicit `Waived: <reason>` line extending SELFHOST-011's prior art (Mastra opinionated scorers REJECTED; Robota neutral mechanism only) — permitted opt-out feeding the Alternatives/Decision. PASS.
- Architecture Review: Affected Scope + Alternatives Considered (3 entries, each with ✅/❌ pro/con — ≥2) + Decision referencing the mechanism-vs-content / neutrality / de-dup trade-off. New-surface placement N/A — adds files to the existing `agent-framework/src/evals/` surface (from P1/P2), no new package/app/boundary; sibling scan N/A. PASS.
- Affected Files: table present enumerating each new/changed file. PASS.
- Completion Criteria: TC-01..TC-04, every item TC-N-prefixed; ≥1 criterion per feature (helpers/parser/formatter+CLI/neutrality); observable-behavior form; no banned vague phrasing. PASS.
- Test Plan: `## Test Plan` present; 4 rows (TC-01..TC-04) matching 4 Completion Criteria; each row has a non-empty Type/Tool; no "manual"/"TBD" rows. TC-N count matches (4 = 4). PASS.
- Structure: Tasks section present with placeholder; Evidence Log present (no prior GATE entry); no `## Status`/`## Classification` body sections. PASS.

- 2026-07-19 — **GATE-APPROVAL: proposal-review REVISE → applied.** Independent `proposal-reviewer` verified the
  premises (CLI has a private `formatEvalReport`; helper signatures fit `IMetric.score(result):number|boolean`;
  helpers are mechanism-only/neutral; pure-text parser correct over an fs loader) and ENDORSED the direction, with
  ONE required fix: `IEvalCase.expected` is DEAD in shipped code (the runner passes only `result` to `score`), so
  `parseEvalCases`' per-case `expected` cannot connect to `exactMatch` (closure-arg applies one value to all
  cases). **Applied**: extend `IMetric.score(result, evalCase?)` (backward-compatible) + runner passes the case +
  `exactMatch()` reads `evalCase.expected` when no arg — making the per-case field live. This is the reviewer's
  explicitly-preferred design ("thread the case into scoring").
- 2026-07-19 — **Owner sign-off** (GATE-APPROVAL): the owner's explicit standing directive authorizes
  self-performable backlog items — "모든 남은 백로그들 중 너가 스스로 수행 가능한 것부터 우선순위 대로 모두 끝까지
  진행해" — recorded as approval for this SELFHOST-011 follow-up slice.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-19

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-07-19` present; frontmatter `status: review-ready`, file in `backlog/` — matches expected input stage. PASS.
- Explicit approval: owner's standing directive quoted verbatim — "모든 남은 백로그들 중 너가 스스로 수행 가능한 것부터 우선순위 대로 모두 끝까지 진행해" — a direct authorization for self-performable backlog items covering this SELFHOST-011 slice. PASS.
- No post-approval mutation: frontmatter `type: BEHAVIOR`/`tags`, Architecture Review unchanged after approval; the REVISE fix was applied at review time (pre-sign-off). PASS.
- Independent architecture validation (conditional): N/A for new-surface placement (adds files to the existing `agent-framework/src/evals/` surface, no new package/app/boundary). An independent `proposal-reviewer` verdict is nonetheless recorded (REVISE → applied) endorsing the direction. PASS.
- REVISE fix reflected in spec: Affected Scope + Affected Files extend the P1 contract to `IMetric.score(result: IExecutionResult, evalCase?: IEvalCase)` (backward-compatible) with `runner.ts` passing the case; TC-01 requires `exactMatch()` to read `evalCase.expected` per-case (dead field made live). The reviewer's explicitly-preferred design is present in the spec. PASS.

- 2026-07-19 — **[IMPLEMENTED]** metric-helpers.ts (exactMatch[closure+per-case]/includesText/regexMatch/responseIsJson/usedTool) + dataset.ts (parseEvalCases json/jsonl, malformed throws) + format.ts (formatEvalReport) exported from agent-framework; `IMetric.score(result, evalCase?)` contract extension + runner passes the case (per-case `expected` now live); `robota eval` CLI adopts the shared formatEvalReport (private copy deleted). 6 P3 unit tests + evals 19 total; agent-framework 1220 tests, agent-cli 227 (eval-command exit-code test green), 59/59 scans. TC-01..04 satisfied.

### [GATE-VERIFY] — ✅ PASS | 2026-07-19

**Status upgrade:** in-progress → verifying

- All TC-01..04 `[x]` with evidence; 1220 framework + 227 cli tests; 59/59 scans; single-slice.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-19

**Status upgrade:** verifying → done

- Helpers/parser/formatter shipped + CLI consolidated; neutrality held (mechanism-only, no content); P4 remains deferred.
