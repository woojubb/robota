---
title: 'TRANS-016: decode JSONL events by event name before replay'
issue: https://github.com/woojubb/robota/issues/2098
status: done
created: 2026-09-03
priority: high
urgency: soon
area: session event persistence
depends_on: [TRANS-005]
---

# TRANS-016: decode JSONL events by event name before replay

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2098](https://github.com/woojubb/robota/issues/2098) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Its earlier `NOT_PLANNED` closure was an administrative queue move, not product delivery. PR #2841 delivered the product outcome on `develop` at `242a6444bb7489c9edf169f1b53f7fb4e1a90507`.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue. The prerelease v1 codec intentionally refuses unversioned logs; no compatibility shim was added.

## Plan

- [x] Revalidate the source Issue against the current tree and name the exact owner boundary.
- [x] Implement the target behavior without parallel ownership or a forwarding facade.
- [x] Add negative and positive regression evidence for the source acceptance conditions.
- [x] Update affected specifications and run package, type, build, and boundary verification.

## Delivery

PR #2841 implements the versioned, event-name discriminated decoder in `agent-session`, reports typed `INVALID_EVENT` failures for unknown or malformed events, and leaves the main snapshot store unchanged. Its package SPEC, changeset, and tests landed together. Hosted `pr-validation`, `security`, `review-policy`, `workflow provenance`, and selected product integration checks succeeded before its squash merge. The source issue's administrative closed state is not counted as implementation evidence.

The eight checked-in CLI/TUI replay JSONL fixtures were still unversioned after PR #2841 and were rejected by its decoder. This follow-up adds only the required v1 envelope, request, and response fields. Direct decoder checks reject all eight original fixtures and accept all eight repaired fixtures while preserving 31 event entries and their existing content. The real binary and PTY results below verify the repaired fixtures.

## Test Plan

The PR #2841 decoder tests exercise accepted v1 replay and typed refusal for invalid entries. On this integration branch, `pnpm --filter '@robota-sdk/agent-cli...' build` passed for 64 selected workspace projects; `pnpm --filter @robota-sdk/agent-session test` passed 440/440 executed tests with 20 declared skips, including 52 codec tests; and `pnpm --filter @robota-sdk/agent-cli test:bin` passed 11/11 real binary tests, including cross-fidelity replay. The first `pnpm --filter @robota-sdk/agent-ui-terminal test:pty` run passed 46/47: `screen-2670-prepark.ptytest.ts` TC-09 missed the closing synchronized-output marker `\x1b[?2026l`. The same full command passed 47/47 on retry without source changes. Affected scans selected 91 checks: 89 passed, one declared skip, and one advisory reference-format finding in the new Task text. After qualifying those references, the exact failing scan passed. PR CI owns the clean-checkout verification.

## User Execution Test Scenarios

The built CLI's `--session-log` path replays a v1 fixture through the programmatic and binary driver; the terminal PTY path replays the same v1 format through the actual UI. Malformed or unversioned logs fail at the canonical session-log decoder. No legacy or parallel replay path is introduced.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
