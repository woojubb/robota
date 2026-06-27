---
title: 'TEST-005: Record-replay (cassette) provider — deterministic real-model functional tests'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: high
urgency: soon
area: packages/agent-core, packages/agent-framework, .agents/skills
depends_on: []
---

# Record-replay (cassette) provider

The scripted provider (TEST-003) verifies the deterministic machinery but **ignores the prompt** and
**fakes the model's tool-use** — exactly the uncertain part of a feature like autonomous goal
pursuit. This adds a record-replay (cassette) provider so a **real** model's behaviour (real prompts
in, real tool-use out) is captured once and replayed deterministically in CI at zero per-run cost.

## Why

A green scripted functional test means "the wiring is correct", not "the feature works with a real
model". The prompts (`buildGoalStartPrompt`, …) and the model's decision to call
`report_goal_status` are never exercised by scripted turns. A cassette closes that gap: it tests the
real prompts and the real model's decisions, deterministically, without flakiness or per-run cost.

## Design (decided)

- **Layer:** `@robota-sdk/agent-core/testing`, sibling to the scripted provider (implements only
  `IAIProvider`); re-exported by `agent-framework/testing`. No reverse dependency.
- **Record mode:** `createRecordingProvider({ provider, cassettePath })` wraps a real provider,
  forwards each `chat()` to it, and appends the `(request, response)` interaction to the cassette
  file. Used in a one-off record run (needs an API key).
- **Replay mode:** `createReplayProvider({ cassettePath })` returns the recorded responses in order,
  with **staleness detection**: each interaction stores a hash of the recorded request; on replay,
  if the incoming request hash diverges (e.g. a prompt changed), it fails with a clear
  "cassette stale — re-record" error rather than silently returning a wrong response. Exhaustion
  fails clearly (mirrors the scripted provider).
- **Cassette format:** JSON `{ version, provider, model, interactions: [{ requestHash,
requestPreview, response }] }`, committed under the test that uses it.
- **Harness integration:** `scriptedSession({ cassette })` builds the session with a replay provider,
  so a functional test runs the real-model flow deterministically through the real `InteractiveSession`.
- **Skill/doc:** the `framework-functional-testing` skill documents when to use scripted vs. cassette
  and the record workflow.

## Done When

- `createRecordingProvider` / `createReplayProvider` exist with round-trip, staleness, and exhaustion
  behaviour covered by self-tests (record from a deterministic underlying provider → replay →
  identical behaviour; a changed request fails stale; an over-run fails clearly).
- The harness accepts `cassette` and drives a real session from it.
- The recording workflow is documented (skill + agent-core SPEC testing section).
- typecheck + lint + tests + `pnpm harness:scan` green; no layering violation.

## Follow-up (needs an API key, tracked separately if not done here)

- Record a **real-model goal cassette** and add a cassette-backed GOAL-001 functional test (real
  prompts + real `report_goal_status` decisions) to the functional-coverage manifest. This is the
  payoff and requires a one-off record run with a provider key.

## Test Plan

- Self-tests for record→replay round-trip, staleness mismatch, and script exhaustion using a
  deterministic underlying provider (no network). Harness `cassette` path covered by a functional
  test that replays a committed fixture cassette.

## User Execution Test Scenarios

Not applicable — agent-facing internal test infrastructure; validated by its self-tests and the
`functional-coverage` scan, recorded as Test Plan evidence. (A real-model cassette capture, when
done, is the product-relevant evidence.)

## Evidence Log (completed 2026-06-27)

- **Cassette provider** (`agent-core/testing/cassette-provider.ts`): `createRecordingProvider`
  (wraps a real provider, writes interactions to a cassette) + `createReplayProvider` (replays with
  request-hash staleness detection over a workspace-scrubbed projection, clear exhaustion errors,
  and `recordCwd → rewriteCwd` rewrite so recorded absolute tool paths land in the replay workspace).
  4 self-tests (round-trip, staleness, exhaustion, cwd rewrite) — deterministic, no key/network.
- **Harness cassette mode**: `scriptedSession({ cassette })` builds the session with a replay
  provider (scrub/rewrite set to the workspace), so a recorded real-model run drives the real loop.
  Requests are captured uniformly in both modes; an option guard requires exactly one of
  `turns`/`cassette`.
- **Session-log leverage** (per the directive to use the system's own logs): the harness exposes the
  REAL transcript the framework writes — `transcript()` / `logEntries()` / `logsDir()` /
  `transcriptPath()` reading `{cwd}/.robota/logs/{sessionId}.jsonl` (`session_init`,
  `provider_request`, `tool_call`, `tool_result`, `assistant`, …). A new
  `session-log-functional.test.ts` asserts a feature against the durable log, not only in-memory
  state. This completes the single-session self-verification surface (in-memory + session record +
  transcript + workspace files + provider requests).
- Skill (`framework-functional-testing`) and SPECs (agent-core, agent-framework) updated: scripted
  vs. cassette modes, the durable-artifact inspectors, and the record workflow.

**Verification:** agent-core 728 tests, agent-framework 1005 tests, full monorepo typecheck exit 0,
`pnpm harness:scan` 33/33; lint 0 errors; no layering violation.

**Follow-up (needs an API key):** record a real-model goal cassette and add a cassette-backed
GOAL-001 functional test (real prompts + real `report_goal_status` decisions) to the
functional-coverage manifest — the payoff that requires a one-off keyed record run.
