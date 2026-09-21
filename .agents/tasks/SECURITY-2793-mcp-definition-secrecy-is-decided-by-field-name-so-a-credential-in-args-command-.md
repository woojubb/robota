---
title: 'SECURITY-2793: MCP definition secrecy is decided by field name, so a credential in `args`/`command` reaches a "secret-free" projection and an env-value change keeps an approval valid'
issue: https://github.com/woojubb/robota/issues/2793
status: todo
created: 2026-09-21
priority: medium
urgency: soon
area: packages/agent-mcp
depends_on: []
---

# SECURITY-2793: MCP definition secrecy is decided by field name, so a credential in `args`/`command` reaches a "secret-free" projection and an env-value change keeps an approval valid

## Objective

Secrecy in `packages/agent-mcp/src/definition/` is decided by FIELD NAME — `env` and `headers` are
the secret bucket — when the real property is per-value. That one taxonomy produces two defects in
opposite directions: a credential expanded into `args`/`command` reaches a projection whose own
contract says "secret-free by construction", and an execution-controlling `env` VALUE change keeps
an MCP-2520 approval valid because only KEYS are fingerprinted.

Neither has a correct local fix, and the information needed to decide is generated and discarded:
`materializeString` records which references it could NOT resolve and keeps nothing about the ones
it did.

## Plan

- [ ] Carry value provenance out of materialization — which spans came from a variable, and whether that variable is credential-shaped
- [ ] Let `projection.ts` redact exactly the expanded-secret spans instead of whole fields, keeping a command line readable
- [ ] Let `identity.ts` cover an execution-controlling value without hashing a credential
- [ ] Remove the containment note from `projection.ts` and `packages/agent-mcp/docs/SPEC.md` once the claim is true again

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Pending design. This Task records a cause found during the MCP-001 review and filed under finding-depth.md; its user-execution disposition is decided when the change is planned, not when the cause is recorded.
