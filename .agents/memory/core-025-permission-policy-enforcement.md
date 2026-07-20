# CORE-025 — background/subagent permissionPolicy enforcement

## STATUS: DONE — merged PR #1258 (squash `5e4145fe6`), on develop (2026-07-21)

In-repo mirror (memory-mirroring rule) of CORE-025. Host mirror: session memory
`core-025-permission-policy-enforcement.md`.

Made `IAgentBackgroundTaskRequest.permissionPolicy` — a required contract field written everywhere and read
NOWHERE (a dead security control) — actually enforce.

## Enforcement seam (the key correctness point)

A spawned subagent's tool gate is `PermissionEnforcer.checkPermission` (agent-session), NOT the interactive
registry. `evaluatePermission`'s `auto` branch returns `true` WITHOUT consulting the approval handler — so
gating "before the interactive request" would leak `deny`/`preapproved` under a permissive mode. The fix
resolves the policy at the TOP of `checkPermission`, BEFORE the mode gate, so
`deny`/`preapproved`/`inherit-allowlist` override even `bypassPermissions`. `prompt` routes to a shared
`promptForApproval` (fail-closes to deny with no surface).

## Semantics (prior-art-anchored)

Claude Code `dontAsk` + `allowedTools`; deny > ask > allow; deny is call-scoped:

- `deny` → deny every call, absolute (does NOT force-fail the task; structured deny fed back to the agent).
- `preapproved` → the task's OWN declared allowlist; matched → allow, else deny.
- `inherit-allowlist` (default) → the PARENT session allowlist (`config.permissions`); matched → allow,
  unmatched → deny (never prompt) — the detached-safe locked-down default.
- `prompt` → route to the approver; no listener → fail-closed deny.
- an explicit deny-list (task or parent) always wins.

## Structure

Pure `resolvePermissionByPolicy(policy, tool, args, {task/parent allow/deny})` in `agent-core` (beside
`evaluatePermission`; shared `matchesAnyPattern`). `TBackgroundPermissionPolicy` SSOT moved DOWN to agent-core
(transport → core is one-way; transport re-exports; consumer import paths unchanged). Plumbed end-to-end
through `ISubagentSpawnRequest` + `toSubagentStartRequest` (the previously-dropped path),
`createSubagentSession`, `Session`/enforcer options, and BOTH the in-process + child-process subagent runners.

## Verification

7 enforcement integration tests at the real gate under `bypassPermissions` (bypass-override proven) + 9
resolver unit tests + 35 permission tests total, no regression; 62/62 harness scans. proposal-reviewer REVISE
(seam corrected agent-executor → agent-session) resolved; pr-review-reviewer 0 MUST/SHOULD. First real
capability to dogfood the [harness-030 capability-reachability floor](harness-030-capability-reachability-floor.md).
