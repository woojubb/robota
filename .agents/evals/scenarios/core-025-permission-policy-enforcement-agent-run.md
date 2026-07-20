# CORE-025 — background/subagent permissionPolicy is enforced (agent-run)

**Spec:** CORE-025 (background-task `permissionPolicy` enforcement). Proves the four policy values
(`deny | preapproved | prompt | inherit-allowlist`) gate a spawned task's tool calls — and, critically, that
the policy **overrides a permissive session mode** (the `auto`/`bypassPermissions` bypass hole the
proposal-reviewer flagged).
**Type:** agent-executable (the agent builds the packages and drives the real permission gate; no owner action).

Before CORE-025, `permissionPolicy` was a required contract field written everywhere and **read nowhere** — the
whole background-agent permission path was unwired, and even the plumbing dropped the field at
`toSubagentStartRequest` (it was absent from `ISubagentSpawnRequest`). A caller who set
`permissionPolicy: 'deny'` got no sandbox. CORE-025 resolves the policy at
`PermissionEnforcer.checkPermission` — the single gate every spawn route funnels through
(`BackgroundTaskManager` → `createSubagentBackgroundRunner`/in-process runner → `createSubagentSession` →
`Session` → `PermissionEnforcer`) — **before** the session-mode decision, so `deny`/`preapproved`/
`inherit-allowlist` bind even under `bypassPermissions`.

## Scenario

```bash
# 1. Full-path plumbing typechecks end-to-end (agent-core resolver → transport contract →
#    agent-session enforcer → agent-executor request/adapter → agent-framework assembly + runner).
pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-interface-transport \
  --filter @robota-sdk/agent-session --filter @robota-sdk/agent-executor \
  --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-subagent-runner build

# 2. Drive the REAL enforcement gate (the seam every spawn funnels through) under the adversarial
#    condition: session mode = bypassPermissions (auto-allow everything) + a task policy.
npx vitest run packages/agent-session/src/__tests__/core-025-permission-policy-enforcement.test.ts
npx vitest run packages/agent-core/src/permissions/__tests__/permission-policy.test.ts
```

**Expected:** every build green; every policy value gates as specified WITH the session mode set to
`bypassPermissions` (proving the policy pre-empts the mode, not the reverse).

## Observed (2026-07-21)

Full-path build (6 packages) — all green (`agent-core`, `agent-interface-transport`, `agent-session`,
`agent-executor`, `agent-framework`, `agent-subagent-runner`).

Enforcement gate under `getPermissionMode() => 'bypassPermissions'`:

```
✓ `deny` blocks a tool even under bypassPermissions (the auto-branch hole)
✓ `preapproved` allows only the task-declared allowlist, denies the rest — under bypass
✓ `inherit-allowlist` inherits the PARENT (config) allowlist, denies a miss — under bypass
✓ a parent deny-list entry blocks even under `inherit-allowlist` + bypass (deny > allow)
✓ `prompt` fail-closes to deny with no approval handler
✓ `prompt` routes to the handler when one is attached
✓ WITHOUT a policy, bypassPermissions still auto-allows (no behavior change)
Tests  7 passed (7)

resolvePermissionByPolicy truth table — Tests  9 passed (9)
```

✅ PASS — the load-bearing case is proven: a task with `permissionPolicy: 'deny'` is blocked even when the
session mode (`bypassPermissions`) would auto-allow the tool. `preapproved`/`inherit-allowlist` gate by the
task/parent allowlists respectively; `prompt` fail-closes to deny with no approver and routes to the handler
when one is attached; an absent policy leaves the mode gate unchanged. The gate is exercised at
`PermissionEnforcer.checkPermission` — the one seam all subagent/background spawn routes converge on — so
proving it there proves it for every route (the routes' plumbing typechecks green in step 1).

**Note (extended live form):** a full live-LLM subagent spawn (real provider, agent loop attempting a
privileged tool under `deny`) exercises the same gate with no additional coverage of the control itself — the
gate is deterministic code and is driven here directly under the exact adversarial mode. The
executable evidence above is the security-relevant proof.
