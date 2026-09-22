---
title: 'CLOSURE-2138: strict-mode optionalAsNullable invites a null the execution validator refuses, so the callable schema and the accepted input disagree for every optional field'
issue: https://github.com/woojubb/robota/issues/2138
status: todo
created: 2026-09-22
priority: low
urgency: later
area: agent-core schema closure (PROV-007) vs tool argument validation
depends_on: []
---

# CLOSURE-2138: strict null compensation vs execution refusal

## Objective

PROV-007's `closeObjectSchemas(…, { optionalAsNullable: true })` (`packages/agent-core/src/schema/close-object-schemas.ts`)
models an optional property as `anyOf [T, null]` for OpenAI strict mode, so the model may legitimately send
`null` — and the tool's argument validator (CORE-040's `ThirdPartySchemaValidator` for MCP tools, the
registry validator for others) then refuses it against the original schema. MCP-005's TC-11 asserts exactly
this asymmetry as "unchanged" (projection must never widen execution input), which is correct, but the
disagreement between the callable schema and the accepted input is a pre-existing gap issue #2528's
"consistent" criterion points at. Found by `proposal-reviewer` on MCP-005 (2026-09-22); filed under
umbrella issue #2138 rather than folded in.

## Plan

- [ ] Decide under #2138: treat a `null` for a field the original schema made optional as "absent" at the execution boundary (one documented normalisation, applied before validation, only for fields the projection nulled), or stop using `optionalAsNullable` and accept strict mode's `required`-all semantics.
- [ ] Implement the decision in one place (the tool execution service or the closure), with a test per provider path.

## Test Plan

Unit test: a strict-projected optional field sent as `null` executes as absent (or the alternative decision's observable).

## User Execution Test Scenarios

Not user-facing beyond fewer refused tool calls under OpenAI strict mode.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
