---
title: 'CMD-008: sessionRequirements is documented as a registration gate ("only register when the runtime is available") but implemented as a demand switch ("module present ⇒ force the runtime on")'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2449#issuecomment-5456241523
created: 2026-08-13
priority: medium
urgency: later
area: packages/agent-command, packages/agent-framework
depends_on: []
---

# CMD-008: sessionRequirements semantics are inverted

## Problem

The SPEC and the contract comment describe `sessionRequirements: ['agent-runtime']` as a registration
gate — the module is "only registered when an agent runtime is available". The only consumer does the
opposite: because a module declaring the requirement is present, it forces the runtime ON. So a
composer that means to exclude the agent runtime cannot rely on the documented gate — including
`/agent` or `/schedule` silently turns the runtime on.

## Evidence

- `packages/agent-command/docs/SPEC.md:30` — declaring the requirement "signals to the session layer
  that this module must only be registered when an agent runtime is available";
  `agent-framework/src/command-api/command-module.ts:17` — "Runtime facilities **required** by this
  module."
- `packages/agent-framework/src/interactive/create-session-projection.ts:63-67` — the ONLY consumer:
  `commandModules?.some(m => m.sessionRequirements?.includes('agent-runtime')) ? { enableAgentRuntime:
true } : {}`. No code path drops or conditionally registers a module on runtime availability.

## Direction

Pick the intended semantics and make doc and code agree. Doc-side (smaller): rewrite the SPEC and
contract comment to "declaring `agent-runtime` causes the session to enable the agent runtime" (the
demand-switch, which is what ships). Code-side (larger): implement the registration gate as
documented, and give composers a way to exclude the runtime without dropping the command. The
demand-switch is defensible and probably what is wanted — but the documentation currently promises the
other behavior. (Note the session-requirement token drift too: four framework SPEC passages say
`agent-executor` where the code's only value is `'agent-runtime'` — folded into DOCS-024.)

## Test Plan

- If doc-side: the SPEC/contract comment match `create-session-projection.ts:63-67`; a test pins that a
  module declaring `agent-runtime` enables the runtime.
- If code-side: a test pins that excluding the runtime while a runtime-declaring module is present is
  achievable (module dropped or runtime stays off per the documented gate).
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

Not applicable if resolved doc-side (documentation of existing behavior). If resolved code-side (a new
composer-facing exclusion path), a scenario building a product that composes `/agent` but excludes the
agent runtime would apply — specify it under that option.
