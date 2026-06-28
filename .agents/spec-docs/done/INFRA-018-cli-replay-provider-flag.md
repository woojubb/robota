---
status: done
type: INFRA
tags: [cli, testing]
---

# INFRA-018: CLI `--session-log` replay flag + deterministic conversation E2E

Second TEST-008 increment. Wires the INFRA-017 replay provider into the built CLI via a flag so a
**recorded session log drives a real conversation deterministically** — no model key, no network. This
unblocks SCREEN-010 TC-02/03 (streaming → commit, end-to-end on the real binary) and is the first
user-runnable form of "drive the agent at will".

## Problem

INFRA-017 shipped `@robota-sdk/agent-provider-replay` (`ReplayProvider`), but nothing constructs it in
the CLI: the built binary only builds providers via `createProviderFromSettings(...)` (network
providers + settings). So a deterministic conversation cannot be run through the real CLI, and
SCREEN-010 TC-02/03 (which need a model response) remain unverifiable end-to-end.

Reproduction: there is no CLI flag to replay a session log; `robota --provider replay` has no effect.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/utils/cli-args.ts` — parse `--session-log <path>`.
- `packages/agent-cli/src/cli.ts` — when replaying (provider `replay` + `--session-log`), construct
  the provider via `createReplayProviderFromLogFile(path)` instead of `createProviderFromSettings`,
  and supply minimal stubs for the settings-derived values (model id, provider settings) so the
  settings/subagent paths do not require a configured network provider.
- `packages/agent-cli/package.json` — add `@robota-sdk/agent-provider-replay` dependency.
- `packages/agent-transport-tui/src/__tests__/pty/` — new PTY E2E driving a recorded conversation.

### Alternatives Considered

**Alt A (chosen): bypass `createProviderFromSettings` for a `--session-log` replay path**

- Pro: smallest seam — the provider instance is the single injection point already consumed by the
  session; replay short-circuits it. Reuses INFRA-017 + the existing TUI transport + PTY harness; no
  new package, no assembly-factory refactor. Delivers the TC-02/03 payoff now.
- Con: replay mode must stub a few settings-derived values (model id, provider settings) that assume a
  configured network provider.

**Alt B: full in-process programmatic adapter + transport-agnostic assembly factory**

- Pro: the elegant "drive in-process, no terminal" form of the north star.
- Con: large refactor of the CLI assembly + a new channel adapter; not required to unblock TC-02/03.
  Deferred to the next increment (INFRA-019 / TEST-008) — explicitly out of scope here.

### Decision

Alt A. Ship the CLI replay flag + a PTY E2E (the payoff). The programmatic adapter + assembly factory
(in-process driving) is the next increment.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-cli (flag + injection), agent-transport-tui (E2E)
- [x] Sibling scan 완료 — `createProviderFromSettings` is the sole provider-instance seam consumed by
      the session; replay short-circuits it without touching settings persistence
- [x] 대안 최소 2개 검토 완료 (A flag-bypass / B in-process adapter+factory)
- [x] 결정 근거 문서화 완료 (minimal seam, reuses INFRA-017 + PTY harness, unblocks TC-02/03)

## Solution

1. **Flag:** parse `--session-log <path>` into `IParsedCliArgs.sessionLog`.
2. **Injection:** in `cli.ts`, when `args.provider === 'replay'` (and `args.sessionLog` set), build
   `const provider = createReplayProviderFromLogFile(args.sessionLog)`; provide minimal stubs for
   `modelId` / `providerSettings` (e.g. `'replay'`) so settings/subagent wiring does not demand a
   configured network provider. Guard so non-replay runs are unchanged.
3. **E2E:** a `*.ptytest.ts` that boots the built CLI with `--provider replay --session-log <fixture>`,
   sends a user message, and asserts the recorded assistant response renders (streaming) then commits
   to `<Static>` scrollback — closing SCREEN-010 TC-02/03 on the real binary. The fixture is a small
   recorded session-log JSONL committed under the test dir.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts`, `packages/agent-cli/src/cli.ts`,
  `packages/agent-cli/package.json`.
- `packages/agent-transport-tui/src/__tests__/pty/replay-conversation.ptytest.ts` (+ a recorded
  session-log fixture).

## Completion Criteria

- [x] TC-01: `robota --session-log <path>` boots the TUI using a `ReplayProvider` built from the log
      (no model key used — the dummy profile's key is never called); `--session-log` parsed into CLI
      args. (`replay-conversation.ptytest.ts` boots + Idle.)
- [x] TC-02: in a PTY, sending a user message yields the recorded assistant response
      (`REPLAYED_ANSWER_42`), which renders and commits in `<Static>` scrollback (real binary).
- [x] TC-03: the input + status bar stay pinned at the bottom while the replayed turn commits above
      (`lastIndexOf('Type a message') > indexOf('REPLAYED_ANSWER_42')`).
- [x] TC-04: a non-replay run (no `--session-log`) is unaffected — `tui-pty.ptytest.ts` (TC-07/08) +
      the other PTY suites stay green (6/6 ptytests pass).
- [x] TC-05: `pnpm --filter @robota-sdk/agent-cli typecheck` + `build` exit 0; agent-cli suite 141
      pass; `pnpm harness:scan` 33/33 (incl. dependency-direction for agent-cli → agent-provider-replay).

## Test Plan

Test strategy derived from type=INFRA, tags=[cli,testing]: real-binary PTY E2E + harness scans.

| TC-ID | Test Type | Tool / Approach                                                                       | Notes                                    |
| ----- | --------- | ------------------------------------------------------------------------------------- | ---------------------------------------- |
| TC-01 | automated | PTY: boot with `--provider replay --session-log <fixture>`, assert prompt + Idle      | No model key; ReplayProvider constructed |
| TC-02 | automated | PTY: send a message, assert recorded response renders then commits once to scrollback | SCREEN-010 TC-03 on the real binary      |
| TC-03 | automated | PTY: assert input/status pinned below the committed replayed turn                     | SCREEN-010 TC-02 on the real binary      |
| TC-04 | automated | existing `tui-pty.ptytest.ts` (no `--session-log`) stays green                        | No regression to normal boot             |
| TC-05 | automated | `pnpm typecheck` + `build` + `pnpm harness:scan`                                      | Must exit 0 / all scans green            |

## User Execution Test Scenarios

- Prereq: built CLI; a recorded session-log JSONL (from any prior real run, or the test fixture).
- Steps: run `robota --provider replay --session-log <path>`; type a message; observe the recorded
  assistant reply stream in and commit to scrollback; scroll back through the replayed conversation.
- Expected: the conversation replays deterministically with no model key; committed turns sit in
  scrollback, input pinned. Matches a real session's behavior.
- Evidence: _to be filled after implementation (PTY E2E is the automated form)._

## Tasks

- [x] `.agents/tasks/completed/INFRA-018.md` — archived (GATE-COMPLETE)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-28

- Frontmatter `type: INFRA`, `tags: [cli, testing]`; Problem w/ reproduction; Architecture Review 4/4
  - 2 alternatives + decision; TC-01–05 + matching Test Plan; Tasks placeholder; empty Evidence Log.
- Result: PASS → `draft` → `review-ready` → `backlog/`.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-28

- User authorized the next TEST-008 increment ("그래"). Scoped (engineering decision, stated to the
  user) to the CLI replay flag + PTY E2E — the payoff that unblocks SCREEN-010 TC-02/03 — sequencing
  the programmatic adapter + assembly factory to a follow-up (INFRA-019). Nothing dropped, only
  sequenced.
- No Architecture Review / type / tags changed after approval.
- Result: PASS → `review-ready` → `approved` → `todo/`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-28

- Tasks file `.agents/tasks/INFRA-018.md` created; tasks map to TC-01–05.
- Result: PASS → `approved` → `in-progress` → `active/`.

### Implementation note (2026-06-28)

`--session-log <path>` alone triggers replay (the provider instance is swapped to a
`ReplayProvider`); the configured provider profile still supplies settings/model but its key is never
used. The replay-coverage discovery: the framework makes >1 provider call per user turn (auto-naming +
conversation), so a replay log must carry a response per call — the fixture provides several (a real
recorded log naturally does).

### [GATE-VERIFY] — ✅ PASS | 2026-06-28

- Prior gate: GATE-IMPLEMENT ✅ PASS; status `in-progress` in `active/`.
- Tasks complete; build (`agent-cli...`) green; agent-cli suite 141 pass; `test:pty` 6 pass
  (incl. `replay-conversation.ptytest.ts`); `pnpm harness:scan` 33/33.
- Result: PASS → `in-progress` → `verifying`.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-28

- **TC-01** ✅ `replay-conversation.ptytest.ts` boots with `--session-log` (ReplayProvider; no key used).
- **TC-02** ✅ sent message → `REPLAYED_ANSWER_42` renders + commits to scrollback (real binary).
- **TC-03** ✅ input/status pinned below the committed reply (assertion on snapshot positions).
- **TC-04** ✅ non-replay `tui-pty` + other PTY suites green (6/6 ptytests).
- **TC-05** ✅ agent-cli typecheck + build exit 0; suite 141 pass; `harness:scan` 33/33.

All Completion Criteria `[x]`; every Test Plan row has a test reference. Tasks archived to
`.agents/tasks/completed/INFRA-018.md`. Result: PASS → `verifying` → `done`; `active/` → `done/`.

**SCREEN-010 TC-02/03 now have an automated real-binary streamed-turn E2E** (the deferred dedicated
test), closed via this replay path. Remaining TEST-008: programmatic in-process adapter + assembly
factory (INFRA-019).
