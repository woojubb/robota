---
status: approved
type: BEHAVIOR
tags: [streaming, cli]
lane: L1
---

# PROV-003: Preserve Gemini streaming tool calls and usage

Design for Task `.agents/tasks/PROV-003-gemini-streaming-discards-tool-calls-and-usage.md`.

## Problem

Gemini's streaming response path currently emits text only. Function calls and usage metadata are
discarded even though the provider advertises function-calling support. Requests for unsupported
native web tools are also silently accepted.

## Decision

Convert response-bearing stream chunks through the existing Gemini response converter, carry tool
calls and usage metadata through `chatStream`, and merge them into the assembled `chat` response.
Validate native web-tool requests at both provider entry points using the inherited capability
contract.

## Affected Scope

- `packages/agent-provider-gemini/src/gemini/execution-helpers.ts`
- `packages/agent-provider-gemini/src/gemini/provider.ts`
- `packages/agent-provider-gemini/src/gemini/provider-extended.test.ts`
- `packages/agent-provider-gemini/docs/SPEC.md`

## Completion Criteria

- [ ] Streaming function calls are present in the returned assistant message.
- [ ] Streaming usage metadata is present in the returned assistant message.
- [ ] Unsupported native web search/fetch requests fail explicitly.
- [ ] Gemini package tests and build pass.

## Test Plan

Use a fixture stream containing text, a function call, and usage metadata; assert the assembled
message preserves all three. Assert both native web-tool request variants fail with the provider
capability error. Run the complete Gemini package test suite and build.

## User Execution Test Scenarios

See the paired Task's applicable scenario: interactive CLI Gemini request requiring a tool call.

## Tasks

- [ ] `.agents/tasks/PROV-003-gemini-streaming-discards-tool-calls-and-usage.md` — implement and verify

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

Problem, decision, affected scope, criteria, and verification plan are recorded.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

Approved for implementation as a high-priority provider behavior fix.

### [GATE-PLAN] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved

The paired Task `.agents/tasks/PROV-003-gemini-streaming-discards-tool-calls-and-usage.md` exists;
this spec is `.agents/spec-docs/todo/PROV-003-gemini-streaming-discards-tool-calls-and-usage.md`.
It carries the automatable `SCENARIO DRAFTED` outcome and
`SCENARIO DRAFTED: automatable | 1`.
`DONE-GATE-STAGE-1` PASS. This planning checkpoint contains only the paired planning artifacts.
