---
status: done
type: INFRA
tags: [cli, typescript, react]
---

# CLI-B12: TuiInteractionChannel lifecycle — single React owner

## Problem

`TuiInteractionChannel` is created outside React (`render.tsx:83-116`: channel constructed
at module scope, then `render(<App channel={channel} createChannel={factory} />)`), while
session switching is React state (`App.tsx:57-84`). Two owners (`render.tsx` for the initial
channel, `App.tsx` for every subsequent one) of one lifecycle caused the CLI-B11 bug class:
the external object and React state silently desynchronized — `/resume` produced
`Context: 0%` because the remounted tree kept the stale external channel. The INFRA-001
factory patch fixed the symptom but left the structural split: the initial channel is still
created in `render.tsx` and threaded through props, so any future code path that touches the
channel before React mounts can recreate the same divergence. Reproduction of the structural
smell: read `render.tsx` — it both creates a channel AND passes a factory whose entire
purpose is to create channels.

## Architecture Review

### Affected Scope

- `packages/agent-transport` / `src/tui/render.tsx` — stop constructing the initial
  channel; pass only `createChannel` (+ `resumeSessionId`)
- `packages/agent-transport` / `src/tui/App.tsx` — own the channel:
  `useState(() => createChannel(resumeSessionId))`; `onSessionSwitch` stops the old channel
  then sets the new one; `createChannel` prop becomes required, `channel` prop removed
- `packages/agent-transport` / `src/tui/__tests__/session-switch-channel.test.tsx` — update
  CLI-B11 TC-04 (no-factory fallback) to the new contract: factory is mandatory
- `packages/agent-transport` / `docs/SPEC.md` — channel lifecycle ownership contract

### Alternatives Considered

1. **Option A — move channel creation into `App` React state (chosen).**
   - Pro: single owner; channel lifecycle is exactly React state lifecycle, so
     switch/remount desync becomes impossible by construction; `useState` lazy initializer
     runs once; CLI-B11 tests keep observing the factory boundary.
   - Con: channel construction happens during first render — must stay side-effect-free
     (I/O starts only in `AppInner`'s `useEffect` via `channel.start()`, which is already
     the case: the constructor only wires objects).
2. **Option B — add `channel.switchSession(id)` and mutate the existing channel.**
   - Pro: minimal React change; no remount.
   - Con: makes the channel a mutable session container — every consumer must handle
     mid-flight session swaps; harder to test and reason about; remount-based cleanup
     (`useEffect` stop/start) would be bypassed.
3. **Option C — keep the current split, export `TuiInteractionChannel` for testability.**
   - Pro: smallest diff.
   - Con: does not fix the two-owner structure that produced the bug; expands the public
     surface for tests only (CLI-B11 already proved in-package tests need no export).

### Decision

Option A. The driving trade-off is structural prevention vs diff size: B-class bugs here
came from lifecycle ownership being split across React and module scope, so the fix is to
make React state the single owner — Options B/C leave that split in place. The unreleased
project status (no-backward-compat rule) lets us make `createChannel` required and delete
the `channel` prop outright instead of deprecating it. `onSessionSwitch` ordering: call
`oldChannel.stop()` (fire-and-forget `void`) before `setState` with the new channel, so the
old channel can never receive events addressed to the new session.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `channel` prop 소비처 전수 확인: `App.tsx`(상태 초기값),
      `AppInner`(start/stop `useEffect` :167-172, key remount), `render.tsx`(생성+주입)
      외 소비처 없음; `TuiInteractionChannel.ts:184-203` start/stop 멱등성 확인;
      생성자는 객체 배선만 수행(I/O 없음 — lazy initializer 안전) 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `App.tsx`: `const [session, setSession] = useState(() => ({ channel:
props.createChannel(props.resumeSessionId), sessionId: props.resumeSessionId }))`;
   `onSessionSwitch(id)`: `void session.channel.stop(); setSession({ channel:
props.createChannel(id), sessionId: id })`. Remove the `channel` prop from `IAppProps`;
   make `createChannel` required.
2. `render.tsx`: delete the eager channel construction; pass `createChannel` and
   `resumeSessionId` only.
3. Update CLI-B11 suite: TC-04 becomes "App renders with only the factory; the factory is
   called once for the initial channel" (fallback path deleted — unreleased project, no
   backward compat).
4. `docs/SPEC.md`: document the ownership contract — the channel is created, replaced, and
   stopped exclusively by `App` React state; `render.tsx` supplies only the factory.

## Affected Files

- `packages/agent-transport/src/tui/render.tsx`
- `packages/agent-transport/src/tui/App.tsx`
- `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx`
- `packages/agent-transport/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `render.tsx` contains no `TuiInteractionChannel` construction; the initial
      channel is created by `App`'s `useState` initializer via the factory, exactly once
      per mount (mock factory call count = 1 on initial render)
- [x] TC-02: session switch stops the old channel before the new channel becomes active
      (ordering observable via spied `stop()` vs factory invocation order)
- [x] TC-03: CLI-B11 TC-A/B/C/E assertions still pass on the new structure. _Correction
      during implementation (within the approved Decision): "unchanged" holds for the
      asserted contracts (factory receives the selected id, one new channel per switch, old
      stopped / active never stopped, real-store restoration), but the suite was
      mechanically adapted to the new channel source — the initial channel is now factory
      call 1 (`undefined`), so switch calls shift to nth 2..4 and the old B11 TC-D
      no-factory fallback test is deleted as specified by this spec's Solution step 3._
- [x] TC-04: `App` no longer accepts a `channel` prop and `createChannel` is required —
      typecheck fails for the old call shape (`pnpm --filter @robota-sdk/agent-transport typecheck` exits 0 on new code)
- [x] TC-05: real TUI boots and `/resume` session switch shows Context > 0% (PTY or
      real-store integration evidence)
- [x] TC-06: `docs/SPEC.md` documents single-owner channel lifecycle (created/replaced/
      stopped only via App state)

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                      | Notes / Test Reference (GATE-COMPLETE)                                                                                                                                                                                                            |
| ----- | ----------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest + ink-testing-library, mock factory, initial-render assertion | Test: `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx > App session-switch channel ownership (CLI-B11) > "TC-01 (B11) / TC-01 (B12): the factory is the sole channel source"` + grep `render.tsx` (no channel passed) |
| TC-02 | unit        | vitest, spied `stop()` + factory order assertion                     | Test: same file > `"TC-03 (B11) / TC-02 (B12): the previous channel is stopped before the new one becomes active"`                                                                                                                                |
| TC-03 | unit        | re-run CLI-B11 suite on new structure                                | Test: `session-switch-channel.test.tsx` full suite (4/4) + `packages/agent-transport/src/tui/__tests__/channel-factory-integration.test.ts` (2/2)                                                                                                 |
| TC-04 | integration | `pnpm --filter @robota-sdk/agent-transport typecheck` + build        | Verified: typecheck exit 0 + `App.tsx:40-58` `IProps` read (required `createChannel`, no `channel`) + suite test `"TC-04 (B12): App renders from the factory alone — no channel prop exists"`                                                     |
| TC-05 | integration | PTY driver (CLI-074) or real-store integration test                  | Test: `channel-factory-integration.test.ts` (2/2 green) + PTY rebuilt-binary evidence recorded in `.agents/backlog/completed/CLI-B12-tui-channel-lifecycle-architecture.md` (Context 0% → 6% → 16%)                                               |
| TC-06 | manual      | SPEC.md diff review                                                  | Skip (no automated test): doc prose, not automatable — manually verified at GATE-COMPLETE by direct read of `packages/agent-transport/docs/SPEC.md:109-111` §TUI lifecycle single-owner paragraph (CLI-B12)                                       |

## Tasks

- [x] `.agents/tasks/completed/CLI-B12.md` — archived at GATE-COMPLETE (T1~T7 complete, TC-01~TC-06 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: INFRA` is one of the 11 allowed prefixes; `tags: [cli, typescript, react]` present.
- Problem — concrete symptom: `/resume` produced `Context: 0%` because remounted tree kept the stale external channel; structural smell at `render.tsx:83-116` (channel constructed at module scope while also passing a factory).
- Problem — reproduction condition: occurs on session switch/remount when external object and React state desynchronize; reproducible by reading `render.tsx`, which both creates a channel AND passes a channel-creating factory.
- Problem — no "TBD"/"TODO" or vague single-sentence description found.
- Architecture Review Checklist: all 4 items `[x]`.
- Sibling scan: `[x]` with completion evidence — `channel` prop consumers enumerated (`App.tsx` state init, `AppInner` start/stop `useEffect` :167-172 + key remount, `render.tsx` create+inject), start/stop idempotency confirmed at `TuiInteractionChannel.ts:184-203`, constructor confirmed side-effect-free.
- Alternatives Considered: 3 entries (A: React-state ownership, B: `switchSession` mutation, C: keep split + export), each with explicit pro and con.
- Decision: references the driving trade-off (structural prevention vs diff size) and cites the no-backward-compat rule for removing the `channel` prop.
- Completion Criteria: 6 items, all prefixed TC-01–TC-06; each uses command form (`pnpm --filter @robota-sdk/agent-transport typecheck` exits 0) or observable behavior (mock factory call count = 1, spied `stop()` ordering, Context > 0%); no forbidden vague phrases ("works correctly", "no errors", "implemented", "displays correctly").
- Test Plan: section present; 6 rows match 6 TC-N (count 6 = 6); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-06) has a Notes entry explaining why it is not automatable (doc prose, reviewed by direct read at GATE-COMPLETE).
- Structure: `## Tasks` present with placeholder (`.agents/tasks/CLI-B12.md` — 미생성); `## Evidence Log` present and empty before this first GATE-WRITE entry; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" (2026-06-13) in direct response to the consolidated approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건", after being told verbatim that replying "승인함" authorizes implementation of the 11 designs.
- Approval directed at this spec: the approval-request message individually summarized CLI-B12 — Option A chosen (channel creation moves into App React state via `useState(() => createChannel(resumeSessionId))`, `channel` prop deleted, `createChannel` required, old channel stopped before new one set) — and explicitly flagged "B12 Option A" as a product-direction decision; "승인함" covers this enumerated item, not a different one.
- Non-approval messages correctly excluded: "머지하고 main 릴리스 진행해줘" (release instruction, executed as docs-only release PR #705) and "그래서 뭐?" (clarifying question) were not counted as design approval.
- No Architecture Review or frontmatter type/tags modified after the approval request: git history for this file contains a single commit (`cd5b1053a`, GATE-WRITE batch); only post-GATE-WRITE changes were the GATE-WRITE Evidence Log entry, frontmatter status draft → review-ready, and prettier formatting; working tree clean.
- NON-COMPLIANCE check (no implementation before this gate): `.agents/tasks/CLI-B12.md` does not exist; `packages/agent-transport` working tree clean; latest commit touching `src/tui` is `5dc0c9649` (CLI-074, prior item) — no CLI-B12 implementation work started.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-B12.md` exists (verified by direct read; present as untracked file on branch `feat/cli-b12-channel-react-ownership`).
- Tasks file path recorded in `## Tasks`: spec's Tasks section lists `.agents/tasks/CLI-B12.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up).
- Tasks correspond to Completion Criteria (one task per TC-N): T1→TC-01 (useState lazy-initializer channel creation, render.tsx construction removed), T2→TC-02 (old channel stop ordering before new channel active), T3→TC-03 (CLI-B11 TC-A/B/C/E regression hold), T4→TC-04 (IAppProps drops `channel`, `createChannel` required, typecheck/build), T5→TC-05 (real-store integration / PTY /resume Context > 0%), T6→TC-06 (docs/SPEC.md single-owner lifecycle contract) — all 6 TC-N covered; T7 is wrap-up (test/typecheck/lint/build + PR + backlog completion), additive beyond the minimum.
- NON-COMPLIANCE check (tasks file before implementation): `git status` shows only spec move (todo → active), the new tasks file, and unrelated evals lessons; `packages/agent-transport/src/tui/App.tsx` and `render.tsx` untouched; latest commit touching `src/tui` is `0c472a40f` (CLI-B11 #706, prerequisite merge) — no CLI-B12 implementation commits exist.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/CLI-B12.md` T1–T6 `[x]`. T7 (wrap-up: PR + backlog completed/) unchecked but every component independently verified per the established CLI-063/064/065/066/B11 GATE-VERIFY interpretation: PR #707 OPEN (`feat/cli-b12-channel-react-ownership` → `develop`, "refactor(transport): single React owner for TuiInteractionChannel lifecycle (CLI-B12)") with all CI checks green on `gh pr checks 707` — build pass (1m28s), quality pass (54s), security audit pass (6s), Cloudflare Pages pass; compat-node18 and release-grade verification report "skipping" by workflow design on feature PRs (same pattern as B11 PR #706); backlog evidence recorded in `.agents/backlog/completed/CLI-B12-tui-channel-lifecycle-architecture.md` (frontmatter `status: done`; all 4 완료 기준 `[x]` with evidence — Option A 승인, App React state sole owner, factory seam + `channel-factory-integration.test.ts`, B11 suite 4/4 + integration 2/2 with TC-D replaced per Solution step 3).
- No tasks blocked or pending: tasks file contains no blocked markers; only T7 wrap-up remains open as adjudicated above. The TC-03 italic correction note (suite mechanically adapted: initial channel = factory call 1 with `undefined`, switch calls shift to nth 2..4, B11 TC-D fallback test deleted as specified in Solution step 3) is a documented in-Decision correction per the CLI-066/B11 correction-note precedent, not a blocked/divergent task.
- Implementation conformance spot-check (fresh-read this gate): `render.tsx` contains no eager `new TuiInteractionChannel` + `channel` prop — only the factory definition (`render.tsx:93-94`) passed as `createChannel` (`render.tsx:99`); `App.tsx` `useState` lazy initializer calls `props.createChannel(props.resumeSessionId)` (`App.tsx:63-68`); `onSessionSwitch` runs `void sessionState.channel.stop()` before `setSessionState` with the new channel (`App.tsx:86-87`); `IProps` has required `createChannel` and no `channel` field (`App.tsx:40-58`).
- Build passes: `pnpm --filter @robota-sdk/agent-transport build` fresh-run this gate — "Build complete in 710ms" (38 files, 481.93 kB), exit 0. Repo-wide build (including type-level consumer `agent-cli`) green via PR #707 CI build job (pass, 1m28s).
- Tests pass: `pnpm --filter @robota-sdk/agent-transport test` fresh-run this gate — **61 files passed / 473 tests passed**, 0 failures, exit 0 (matches the expected 61/473 from the B11 baseline carried onto the new structure).

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: TC-01 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/tui/__tests__/session-switch-channel.test.tsx` (cwd `packages/agent-transport`) — test `App session-switch channel ownership (CLI-B11) > TC-01 (B11) / TC-01 (B12): the factory is the sole channel source — once at mount, once per switch with the selected sessionId` ✓ passed (1064ms), suite 4/4, exit 0.
- Grep: `rg -n "TuiInteractionChannel|createChannel|channel" packages/agent-transport/src/tui/render.tsx` — `new TuiInteractionChannel(...)` appears only inside the `createChannel` factory body (`render.tsx:93-94`), passed as `createChannel` prop (`render.tsx:99`); no constructed channel is passed to `App` (no `channel` prop anywhere in the file).

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: TC-02 is `[x]` in `## Completion Criteria`.
- Command: same suite run — test `App session-switch channel ownership (CLI-B11) > TC-03 (B11) / TC-02 (B12): the previous channel is stopped before the new one becomes active` ✓ passed (999ms), exit 0. Ordering asserted via mock `invocationCallOrder` (spied `stop()` before factory invocation for the new channel).

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: TC-03 is `[x]` in `## Completion Criteria`.
- Command 1: `npx vitest run src/tui/__tests__/session-switch-channel.test.tsx` — **4 tests passed (4)**, 0 failures, exit 0 (TC-01/TC-02/TC-04/TC-05 names listed in output; B11 contracts hold on the new structure per the spec's documented in-Decision adaptation note — initial channel is factory call 1, B11 TC-D fallback test deleted per Solution step 3).
- Command 2: `npx vitest run src/tui/__tests__/channel-factory-integration.test.ts` — **2 tests passed (2)**, 0 failures, exit 0 (real-store restoration path on the new structure).

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: TC-04 is `[x]` in `## Completion Criteria`.
- Command: `pnpm --filter @robota-sdk/agent-transport typecheck` — `tsc --noEmit` completed with no output, exit 0.
- Direct read `App.tsx:40-58`: `IProps` declares `createChannel: (resumeSessionId?: string) => TuiInteractionChannel` as required (JSDoc "Sole channel source (CLI-B12)"); no `channel` field exists in `IProps` — the old call shape cannot typecheck.
- Corroborating test: same suite — `TC-04 (B12): App renders from the factory alone — no channel prop exists` ✓ passed (582ms).

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Checkbox: TC-05 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/tui/__tests__/channel-factory-integration.test.ts` — 2/2 passed, exit 0 (real-store integration: restored context end to end on the single-owner structure).
- PTY evidence (direct read): `.agents/backlog/completed/CLI-B12-tui-channel-lifecycle-architecture.md` "## Evidence (2026-06-13)" records the rebuilt-binary PTY scenario on the single-owner structure: `Context: 0% → 6% (11.9K/200K) → 16% (31.8K/200K)` across consecutive `/resume` switches — Context > 0% after switch, satisfying the criterion.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-13

- Checkbox: TC-06 is `[x]` in `## Completion Criteria`.
- Manual verification (direct read, per Test Plan skip reason — doc prose, not automatable): `packages/agent-transport/docs/SPEC.md:109-111` — section `### TUI lifecycle` contains the paragraph "**Single channel owner (CLI-B12):** `renderApp()` does NOT construct a channel. It passes only a `createChannel(resumeSessionId?)` factory … `App` creates the initial `TuiInteractionChannel` … in its `useState` lazy initializer and replaces it on every session switch — the old channel is stopped (`void channel.stop()`) before the replacement becomes active. … The channel lifecycle is therefore exactly the React state lifecycle: created, replaced, and stopped exclusively through `App` state, with no second owner outside React." — documents created/replaced/stopped only via App state, exactly as the criterion requires.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- All 6 Completion Criteria checkboxes `[x]`, each with a matching `[GATE-COMPLETE: TC-N]` Evidence entry above (exact command, observed output, exit code).
- `## Test Plan` updated this gate: TC-01–TC-05 rows carry explicit test file + test name references; TC-06 row carries an explicit skip reason (doc prose, manually verified by direct read of `SPEC.md:109-111`).
- No TC-N silently unaddressed: 6/6 rows resolved (5 test references, 1 documented manual skip).
- Tasks file archived: `.agents/tasks/completed/CLI-B12.md` exists (verified by `ls` + direct read) with T1–T7 all `[x]`; `.agents/tasks/CLI-B12.md` no longer exists at the active path.
- `## Tasks` section reflects the archived path: spec lists `.agents/tasks/completed/CLI-B12.md` — archived at GATE-COMPLETE (T1~T7 complete, TC-01~TC-06 매핑).
- Fresh test evidence this gate: session-switch suite 4/4 + channel-factory integration 2/2 + typecheck exit 0, all run 2026-06-13.
