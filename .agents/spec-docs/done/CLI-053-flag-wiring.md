---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-053: CLI flag wiring — tool filters in both modes, --dry-run semantics, --json-schema discoverability (covers backlog CLI-053/054/055)

## Problem

Three advertised CLI flags do not behave as documented:

1. **`--denied-tools` never consumed** — parsed into `IParsedCliArgs.deniedTools`
   (`packages/agent-cli/src/utils/cli-args.ts:195`) but never read again anywhere. Print mode
   passes only `allowedTools` (`src/modes/print-mode.ts:46-51`);
   `HeadlessInteractionChannel` options have no `deniedTools` field
   (`packages/agent-transport/src/headless/HeadlessInteractionChannel.ts:33,65`). Reproduce:
   `robota -p "run ls" --denied-tools Bash` → Bash executes anyway.
2. **Tool filters dead in TUI mode** — `IRenderOptions`
   (`packages/agent-transport/src/tui/render.tsx:26-51`) has neither `allowedTools` nor
   `deniedTools`, although `TuiInteractionChannel` already accepts both
   (`TuiInteractionChannel.ts:68-69`) and the SDK applies them as permission deny/allow
   patterns (`agent-framework/src/assembly/create-session.ts:192`). Reproduce:
   `robota --allowed-tools Read` (TUI) → all tools remain available.
3. **`--dry-run` silently ignored** — parsed (`cli-args.ts:210`) and advertised in help as
   "Plan-only mode: show what the agent would do without modifying files", but the value has
   zero readers. Users relying on it get full execution including writes — a safety defect.
4. **`--json-schema` undiscoverable** — functional (wired into the appended system prompt at
   `src/startup/append-system-prompt.ts:26-29`) but absent from `printHelp()`
   (`cli-args.ts:57-95`) and the SPEC flag list.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/utils/cli-args.ts` — shared `parseToolList()` helper, `--json-schema`
  help line, `--dry-run` help line updated to alias semantics
- `packages/agent-cli/src/cli.ts` — dry-run → permissionMode mapping (conflict guard), tool
  filter lists passed to `renderApp`
- `packages/agent-cli/src/modes/print-mode.ts` — pass `deniedTools`; use shared list parsing;
  dry-run mapping applies before channel creation
- `packages/agent-transport/src/headless/HeadlessInteractionChannel.ts` — add `deniedTools`
  option, threaded to session init (mirror of `allowedTools`)
- `packages/agent-transport/src/tui/render.tsx` — add `allowedTools`/`deniedTools` to
  `IRenderOptions`, pass to `TuiInteractionChannel` (already supported there)
- `packages/agent-cli/docs/SPEC.md`, `packages/agent-transport/docs/SPEC.md` — flag/option
  contract updates in the same PR

### Alternatives Considered

**A. `--dry-run` as a new first-class execution mode (separate code path that simulates tools)**

- Pro: richest possible "show what would happen" output
- Con: large new surface duplicating the existing permission system; "no fallback" rules forbid
  simulated tool results; the SDK already has exactly this concept as `permissionMode: 'plan'`
  ("Plan only, no execution")

**B. Map `--dry-run` to the existing `permissionMode: 'plan'` (alias), error on conflict**

- Pro: zero new execution semantics — reuses the SDK's plan mode which already blocks
  execution; honest help text; conflict with an explicit different `--permission-mode` is a
  hard error (no silent override)
- Con: help text must be rephrased from "show what the agent would do" to plan-mode wording

**C. Remove `--dry-run` entirely**

- Pro: smallest change
- Con: deletes a useful, already-advertised safety affordance that the SDK can express today;
  README/SPEC list it — removal churns docs for no user benefit

### Decision

**B 채택** — the SDK already owns the exact semantic (`'plan'`: "Plan only, no execution");
an alias keeps one source of truth for execution-blocking behavior instead of inventing a second
mechanism (A) or deleting a shippable feature (C). Trade-off: `--dry-run --permission-mode X`
(X ≠ plan) must fail fast with a clear message rather than guessing intent. Tool filters reuse
the existing SDK allow/deny pattern pipeline end-to-end; the only new code is option threading.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-cli (args/composition), agent-transport
      (headless + tui option threading); SDK 계층은 무변경 (이미 지원)
- [x] Sibling scan 완료 — `allowedTools`가 이미 지나는 경로(print-mode → HeadlessInteractionChannel
      → session init / TuiInteractionChannel → use-interactive-session-init)를 확인하고
      `deniedTools`를 동일 경로로 미러링; permissionMode 전달 경로(render.tsx:65, print-mode:41)
      확인 후 dry-run 매핑을 동일 지점 상류(cli.ts)에 배치
- [x] 대안 최소 2개 검토 완료 — A(신규 모드)/B(plan alias)/C(제거) 3안 검토
- [x] 결정 근거 문서화 완료 — Decision 섹션 참조

## Solution

1. `cli-args.ts`: export `parseToolList(value?: string): string[] | undefined` (comma split,
   trim, drop empties); add `--json-schema <schema>` to help; reword `--dry-run` help to
   "Alias for --permission-mode plan (plan only, no execution)".
2. `cli.ts`: resolve effective permission mode once —
   `--dry-run` + no `--permission-mode` → `'plan'`; `--dry-run` + `--permission-mode plan` →
   `'plan'`; `--dry-run` + other mode → stderr error + exit 1. Pass
   `allowedTools`/`deniedTools` (via `parseToolList`) to `renderApp`.
3. `print-mode.ts`: use `parseToolList` for both lists; pass `deniedTools`; effective
   permission mode passed in (dry-run mapping included; print-mode default remains
   `bypassPermissions` when neither flag given).
4. `HeadlessInteractionChannel`: add `deniedTools?: string[]` option, thread to session init
   exactly like `allowedTools`.
5. `render.tsx`: add `allowedTools?: string[]` / `deniedTools?: string[]` to `IRenderOptions`,
   pass into `TuiInteractionChannel` constructor options.
6. SPEC updates: agent-cli SPEC flag list (`--dry-run` alias wording, `--json-schema` row,
   tool filter "both modes" note); agent-transport SPEC headless/tui option tables.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts` (+ `src/utils/__tests__/cli-args.test.ts`)
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-transport/src/headless/HeadlessInteractionChannel.ts`
- `packages/agent-transport/src/tui/render.tsx`
- `packages/agent-cli/docs/SPEC.md`, `packages/agent-transport/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `robota -p "<prompt>" --denied-tools Bash` produces a session where Bash is denied —
      verified by unit test that `HeadlessInteractionChannel` receives `deniedTools: ['Bash']`
      and by E2E transcript showing the tool blocked/unavailable
- [x] TC-02: `renderApp({ allowedTools, deniedTools })` passes both lists to
      `TuiInteractionChannel` (unit/type-level verified) and `robota --allowed-tools Read`
      reaches the channel with `['Read']`
- [x] TC-03: `robota -p "<prompt>" --dry-run` runs with `permissionMode: 'plan'`;
      `robota --dry-run --permission-mode acceptEdits` exits 1 with a conflict error message;
      `--dry-run --permission-mode plan` is accepted
- [x] TC-04: `robota --help` output contains `--json-schema` and the plan-alias wording for
      `--dry-run`
- [x] TC-05: `parseToolList` unit tests — undefined, empty string, `"A,B"`, `" A , ,B "` cases
- [x] TC-06: `pnpm --filter @robota-sdk/agent-cli build/test` and
      `pnpm --filter @robota-sdk/agent-transport build/test` all green; SPEC files updated

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                                    | Notes                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | unit + E2E | vitest (headless channel options) + built bin 실행 transcript 확인 | Test: `packages/agent-transport/src/headless/__tests__/headless-channel-options.test.ts` > "TC-01: passes deniedTools through to the InteractiveSession options"; deny-wins chain: `packages/agent-core/src/permissions/__tests__/permission-gate.test.ts`. Live-LLM E2E transcript skipped — no API credentials in environment (unit chain fully verified). |
| TC-02 | unit       | vitest — render options → channel 전달 (channel 옵션 스파이)       | full TUI 렌더는 raw-mode 필요 — 옵션 전달 계약만 단위 검증. Test: `packages/agent-transport/src/tui/__tests__/render-channel-options.test.ts` > "TC-02: threads allowedTools and deniedTools into the channel options"                                                                                                                                       |
| TC-03 | unit + E2E | vitest (모드 해석 함수) + built bin 충돌 케이스 exit code 확인     | Test: `packages/agent-cli/src/utils/__tests__/cli-args.test.ts` > "--dry-run permission mode alias" (3 cases); E2E: built bin conflict case → stderr message + exit 1 (see Evidence Log TC-03)                                                                                                                                                               |
| TC-04 | unit       | vitest — printHelp() 스냅샷/contains                               | Test: `packages/agent-cli/src/utils/__tests__/cli-args.test.ts` > "printHelp flag coverage" (3 cases); `robota --help` output verified (see Evidence Log TC-04)                                                                                                                                                                                              |
| TC-05 | unit       | vitest — parseToolList 케이스                                      | Test: `packages/agent-cli/src/utils/__tests__/cli-args.test.ts` > "parseToolList" (4 cases)                                                                                                                                                                                                                                                                  |
| TC-06 | build/test | pnpm filter build + test (agent-cli, agent-transport)              | Commands run: agent-cli build/typecheck/lint/test 103/103; agent-transport build/typecheck/lint/test 453/453; agent-core 702/702 (see Evidence Log TC-06 + GATE-VERIFY)                                                                                                                                                                                      |

## Tasks

- `.agents/tasks/completed/CLI-053.md` — created 2026-06-11, 7 tasks (T1–T7) mapped to TC-01…TC-06; archived 2026-06-11 (all tasks complete)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-10

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem — concrete symptom: 4 numbered defects each cite exact file:line (e.g. `cli-args.ts:195`, `print-mode.ts:46-51`, `render.tsx:26-51`, `append-system-prompt.ts:26-29`).
- Problem — reproduction condition: explicit repro commands given (`robota -p "run ls" --denied-tools Bash`, `robota --allowed-tools Read` in TUI, `--dry-run` full execution, `--json-schema` absent from `printHelp()`).
- Problem — no "TBD"/"TODO"/vague single-sentence descriptions found.
- Architecture Review Checklist: all 4 items are `[x]`.
- Sibling scan: `[x]` with completion evidence (allowedTools path traced print-mode → HeadlessInteractionChannel → session init and TuiInteractionChannel → use-interactive-session-init; permissionMode path at render.tsx:65 / print-mode:41).
- Alternatives Considered: 3 entries (A new mode / B plan alias / C removal), each with pro and con.
- Decision: references the driving trade-off (fail-fast on `--dry-run` + conflicting `--permission-mode` vs. inventing a second mechanism or deleting the feature).
- Completion Criteria: 6 items, all prefixed TC-01…TC-06; each distinct defect covered (TC-01 denied-tools headless, TC-02 TUI filters, TC-03 dry-run alias, TC-04 help discoverability, TC-05 parser, TC-06 build/test+SPEC); all use command or observable-behavior form; no banned phrases ("works correctly", "no errors", "implemented", "displays correctly") present.
- Test Plan: section present; 6 rows match the 6 TC-N criteria (count match confirmed); every row has non-empty Test Type and Tool/Approach with no "TBD"; no row uses Tool "manual", so the manual-Notes requirement is N/A (TC-02 carries an explanatory note regardless).
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` present and empty before this entry; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-10

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user stated verbatim on 2026-06-10 — "cjk 관련된 것 빼고 나머지 모두 진행해줘. pr을 올리면서 머지하며 작업해줘. feature 브랜치 -> develop -> main" — after being presented the 14 audit backlog items CLI-049~CLI-062, which include CLI-053/054/055 covered by this spec.
- Direct and unambiguous, directed at this spec: "진행해줘" authorizes all presented items except CJK-related CLI-061/062; this document covers CLI-053/054/055, none of which are CJK-related, so it is squarely inside the approved set (not approval of a different item, not a mere clarifying answer).
- No Architecture Review or frontmatter type/tags modified after approval: file is a single uncommitted addition in the working tree with GATE-WRITE recorded 2026-06-10 and no edits after the approval statement; frontmatter remains `type: BEHAVIOR`, `tags: [cli, typescript]`.
- NON-COMPLIANCE trigger check: no implementation started before this gate — `git status --porcelain packages/agent-cli packages/agent-transport` returned empty (no working-tree changes in affected packages); only the separately-gated CLI-049 PR was merged previously.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-11

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-053.md` exists with 7 tasks (T1–T7).
- Tasks file path recorded in `## Tasks` section: placeholder replaced with the path and task count during this gate run.
- Tasks correspond to Completion Criteria — at minimum one task per TC-N: T3→TC-01 (HeadlessInteractionChannel deniedTools threading), T4→TC-02 (IRenderOptions → TuiInteractionChannel), T2→TC-03 (dry-run → plan alias resolver + conflict exit 1), T5→TC-04 (help text --json-schema / plan-alias wording), T1→TC-05 (parseToolList + unit tests), T6→TC-06 (SPEC updates + build/test green); T7 additionally covers E2E evidence runs for TC-01/TC-03.
- NON-COMPLIANCE trigger check: tasks file exists, so the "implementation commits without tasks file" trigger does not apply.

### [GATE-COMPLETE: TC-01] — ✅ | 2026-06-11

**Test:** `packages/agent-transport/src/headless/__tests__/headless-channel-options.test.ts` > "TC-01: passes deniedTools through to the InteractiveSession options" — channel receives `deniedTools: ['Bash','Glob']` (1/1 pass).
**Deny semantics chain:** session assembly maps names to deny patterns (`agent-framework/src/assembly/create-session.ts:192`); `evaluatePermission` deny is step 1, above mode policy — new tests `packages/agent-core/src/permissions/__tests__/permission-gate.test.ts` (4/4 pass) prove deny wins even in `bypassPermissions` (print-mode default).
**E2E live-LLM transcript:** skipped — no API credentials in this environment (`~/.robota/settings.json` has none, env empty). User scenario in backlog CLI-053 remains directly runnable with a configured key; every link of the chain is unit-verified.

### [GATE-COMPLETE: TC-02] — ✅ | 2026-06-11

**Test:** `packages/agent-transport/src/tui/__tests__/render-channel-options.test.ts` > "TC-02: threads allowedTools and deniedTools into the channel options" (2/2 pass) — `toChannelOptions()` extracted from `renderApp()` for contract testing; `cli.ts` passes `parseToolList(args.allowedTools/deniedTools)` into `renderApp`.

### [GATE-COMPLETE: TC-03] — ✅ | 2026-06-11

**Command:** `node packages/agent-cli/bin/robota.cjs --dry-run --permission-mode acceptEdits -p "hi"` → stderr "--dry-run is an alias for --permission-mode plan and conflicts with --permission-mode acceptEdits", exit code 1.
**Tests:** cli-args.test.ts "--dry-run permission mode alias" (3 cases: maps to plan / accepts explicit plan / throws on conflict) — pass.

### [GATE-COMPLETE: TC-04] — ✅ | 2026-06-11

**Command:** `node packages/agent-cli/bin/robota.cjs --help` → contains `--json-schema <schema>`, `--dry-run  Alias for --permission-mode plan (plan only, no execution)`, `--allowed-tools`, `--denied-tools`, and the `robota diagnose` command row.
**Tests:** cli-args.test.ts "printHelp flag coverage" (3 cases) — pass.

### [GATE-COMPLETE: TC-05] — ✅ | 2026-06-11

**Tests:** cli-args.test.ts "parseToolList" — undefined → undefined, '' → undefined, 'Read,Bash' → ['Read','Bash'], ' Read , ,Bash ' → ['Read','Bash'] (4/4 pass).

### [GATE-COMPLETE: TC-06] — ✅ | 2026-06-11

**Commands:** `pnpm --filter @robota-sdk/agent-cli build/typecheck/lint/test` → build ok, 0 type errors, 0 lint errors, 103/103 tests; `pnpm --filter @robota-sdk/agent-transport build/typecheck/lint/test` → build ok, 0 type errors, 453/453 tests; `pnpm --filter @robota-sdk/agent-core build/typecheck/test` → 702/702 tests. SPEC updates: agent-cli flag list (dry-run alias, --json-schema row, both-modes note), agent-transport `IRenderOptions` block (stale `ITuiRenderOptions` name fixed) + `toChannelOptions` documented.

### [GATE-VERIFY] — ✅ PASS | 2026-06-11

**Status upgrade:** in-progress → verifying

- Tasks file completion: `.agents/tasks/completed/CLI-053.md` — all 7 tasks T1–T7 are `[x]`; no task marked blocked or pending.
- Build (affected packages): `pnpm --filter @robota-sdk/agent-cli build` → "Build complete in 690ms"; `pnpm --filter @robota-sdk/agent-transport build` → "Build complete in 643ms" (both exit 0).
- Tests: `pnpm --filter @robota-sdk/agent-cli test` → 103/103 passed (10 files); `pnpm --filter @robota-sdk/agent-transport test` → 453/453 passed (55 files); `pnpm --filter @robota-sdk/agent-core test` → 702/702 passed (47 files).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-11

**Status upgrade:** verifying → done

- Completion Criteria: all 6 checkboxes TC-01…TC-06 are `[x]`.
- Per-TC evidence: a `[GATE-COMPLETE: TC-N]` Evidence Log entry exists for each of TC-01…TC-06, each with the exact command or test reference and observed result (TC-03 includes exit code 1 for the conflict case).
- TC-01 partial skip: live-LLM E2E transcript explicitly skipped with reason — no API credentials in this environment; the unit chain (headless channel option threading + deny-wins permission-gate tests) is fully verified.
- Test Plan: all 6 rows updated with test file references (`headless-channel-options.test.ts`, `render-channel-options.test.ts`, `permission-gate.test.ts`, `cli-args.test.ts`) or commands run; TC-01 row carries the explicit E2E skip reason — no TC-N is silently unaddressed.
- Referenced test files verified to exist on disk: `packages/agent-transport/src/headless/__tests__/headless-channel-options.test.ts`, `packages/agent-transport/src/tui/__tests__/render-channel-options.test.ts`, `packages/agent-core/src/permissions/__tests__/permission-gate.test.ts`.
- Tasks file archived: `.agents/tasks/completed/CLI-053.md` exists; `.agents/tasks/CLI-053.md` no longer present.
- `## Tasks` section updated to reflect the archived path.
