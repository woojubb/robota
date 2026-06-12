---
status: approved
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

- [ ] TC-01: `render.tsx` contains no `TuiInteractionChannel` construction; the initial
      channel is created by `App`'s `useState` initializer via the factory, exactly once
      per mount (mock factory call count = 1 on initial render)
- [ ] TC-02: session switch stops the old channel before the new channel becomes active
      (ordering observable via spied `stop()` vs factory invocation order)
- [ ] TC-03: CLI-B11 TC-A/B/C/E assertions still pass unchanged on the new structure
- [ ] TC-04: `App` no longer accepts a `channel` prop and `createChannel` is required —
      typecheck fails for the old call shape (`pnpm --filter @robota-sdk/agent-transport typecheck` exits 0 on new code)
- [ ] TC-05: real TUI boots and `/resume` session switch shows Context > 0% (PTY or
      real-store integration evidence)
- [ ] TC-06: `docs/SPEC.md` documents single-owner channel lifecycle (created/replaced/
      stopped only via App state)

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                      | Notes                                                                 |
| ----- | ----------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| TC-01 | unit        | vitest + ink-testing-library, mock factory, initial-render assertion | factory called once, no eager channel in render.tsx (grep + test)     |
| TC-02 | unit        | vitest, spied `stop()` + factory order assertion                     | old stopped before new active                                         |
| TC-03 | unit        | re-run CLI-B11 suite on new structure                                | regression hold                                                       |
| TC-04 | integration | `pnpm --filter @robota-sdk/agent-transport typecheck` + build        | old prop shape removed                                                |
| TC-05 | integration | PTY driver (CLI-074) or real-store integration test                  | restored context > 0 end to end                                       |
| TC-06 | manual      | SPEC.md diff review                                                  | doc prose — reviewed at GATE-COMPLETE by direct read, not automatable |

## Tasks

- [ ] `.agents/tasks/CLI-B12.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

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
