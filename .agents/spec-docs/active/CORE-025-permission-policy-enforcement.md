---
status: in-progress
type: SECURITY
tags:
  [permission, background-tasks, agent-executor, agent-framework, enforcement, security, capability]
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/core-025-permission-policy-enforcement-agent-run.md
---

# CORE-025: background-task permissionPolicy enforcement (preapproved / prompt / deny / inherit-allowlist)

## Problem

`IAgentBackgroundTaskRequest.permissionPolicy: TBackgroundPermissionPolicy`
(`'inherit-allowlist' | 'preapproved' | 'prompt' | 'deny'`) is a **required contract field that is written
everywhere and read nowhere** — a dead security control:

- `packages/agent-interface-transport/src/background-task-contracts.ts:29,89` — declares the type + required field.
- `packages/agent-framework/src/background-tasks/execution-workspace-spawner.ts:113` — `request.permissionPolicy ?? 'inherit-allowlist'` (defaulted, then dropped).
- `packages/agent-executor/src/subagents/subagent-manager.ts:131` — hard-coded `'inherit-allowlist'`.
- No reader anywhere: `background-task-manager.ts` (397 lines) has **zero** permission handling.

The background-task state machine (`agent-executor/src/background-tasks/state-machine.ts`) DEFINES the
transitions `running --REQUEST_PERMISSION--> waiting_permission`, `waiting_permission --PERMISSION_ALLOWED-->
running`, `waiting_permission --PERMISSION_DENIED--> failed` — but **nothing dispatches them**. So a spawned
background agent's privileged tool calls are not gated by its declared policy at all. This is a
forward-provisioned security surface that must be wired to enforce, per the CORE-025 re-audit (P2-11 /
CONTRACT-004): a required field that silently does nothing is worse than absent — a caller believes
`permissionPolicy: 'deny'` sandboxes a task when it does not.

## Prior Art Research

**Topic:** Enforcement semantics for a background/detached agent task permission policy
(`inherit-allowlist | preapproved | prompt | deny`).

### References consulted (product documentation)

- **Claude Code — Choose a permission mode** (`default`, `acceptEdits`, `plan`, `dontAsk`,
  `bypassPermissions`; non-interactive fallback): https://code.claude.com/docs/en/permission-modes
- **Claude Agent SDK — Configure permissions** (6-step order: hooks → deny → ask → mode → allow → `canUseTool`;
  `allowedTools`/`disallowedTools`): https://code.claude.com/docs/en/agent-sdk/permissions
- **Claude Code — Headless / programmatic** (`-p`, `--allowedTools`, `--permission-mode`, locked-down CI):
  https://code.claude.com/docs/en/headless
- **OpenAI Agents SDK — Human-in-the-loop / approvals** (`needsApproval`, `interruptions`,
  `approve()`/`reject()`, `alwaysApprove`): https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
- **LangChain / LangGraph — Human-in-the-loop** (`interrupt_on`, `approve|edit|reject|respond`, checkpointer +
  `thread_id` durable pause, `Command(resume=...)`): https://docs.langchain.com/oss/python/deepagents/human-in-the-loop

### Observed common behavior

1. **Layered evaluation, deny wins in every mode.** Claude Agent SDK order: hooks → **deny** → ask → mode →
   allow → prompt; a deny rule blocks even under `bypassPermissions`. "deny beats ask beats allow" dominates.
2. **Four recurring tiers:** allow-listed/pre-approved (run without prompting), prompt/ask (route to a human at
   runtime), deny (block THIS call, feed the reason back — not kill the run), bypass/allow-all ("isolated
   containers only").
3. **Detached prompt with no human — two schools:** (a) **fail-closed auto-deny** (Claude `dontAsk` "never
   waits for input"; `-p` "repeated blocks abort the session since there is no user to prompt"); (b) **durable
   pause-and-resume** (OpenAI `interruptions` + serialized state; LangGraph checkpointer) — safe to wait ONLY
   because the pause is durable state with a registered resolver. Neither is an indefinite in-memory wait.
4. **Deny is call-scoped everywhere** — Claude "receives the reason and tries an alternative"; OpenAI/LangGraph
   `reject` → "return rejection feedback to the agent." No reference hard-kills the run on a single denial.

### Constraints for Robota

- A detached background task IS Claude Code's "non-interactive / no user to prompt" case. In-memory
  block-and-wait on `prompt` leaks the task (no timeout, no durable state, no thread to answer). Both schools
  reject that: fail-closed deny, OR durable-persist with a resolver.
- `permissionPolicy` is per-task, so the absent-surface behavior must be well-defined, not just attached.
- Deny must be call-scoped; a denial that hard-kills the task diverges from all four references.

### Recommendation (adopted in the Decision below)

Precedence chain deny > prompt > allow, fail-closed absent-surface: `inherit-allowlist` = matched→allow,
**unmatched→deny (never prompt)** (Claude's locked-down `dontAsk` + `allowedTools`); `preapproved` =
task-declared allow set, else deny; `prompt` = listener→emit, **no listener→fail-closed deny** (bounded
timeout may resolve to deny, never allow); `deny` = deny the CALL + return feedback, do not force-fail the
task. **Default = `inherit-allowlist`** (most restrictive that still runs pre-declared work).

PRIOR_ART_RESEARCH: FOUND

## Decision — enforcement semantics of the four policy values

Anchor on the EXISTING, mature interactive permission model
(`agent-framework/src/interactive/session-prompt-registry.ts` `requestPermission`), already **fail-closed**
(no surface → deny). The per-task policy is the pre-decision layer ABOVE that request. Refined by prior art so
the **detached, no-surface case is fail-closed by construction** — `inherit-allowlist` denies (not prompts) on
a miss, matching Claude Code's locked-down `dontAsk` + `allowedTools` recipe:

| Policy                        | Semantics on a tool-permission decision                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deny`                        | Deny **this tool call** (structured deny fed back to the agent). Never emit a request. Does NOT force-fail the task — the agent may adapt.                      |
| `preapproved`                 | Allow if the tool ∈ the task's declared `allowedTools` (and ∉ `disallowedTools`); otherwise deny. A task-declared pre-approval set, not allow-all.              |
| `prompt`                      | Listener attached → emit a `permission_request` and await the human decision. **No listener → fail-closed to deny** (bounded timeout may resolve to deny only). |
| `inherit-allowlist` (default) | Inherit parent/session allow rules: tool ∈ allowlist (and ∉ `disallowedTools`) → allow; **unmatched → deny, never prompt** (detached-safe locked-down default). |

Resolved sub-decisions (prior-art-validated):

1. **`prompt` with no attached surface → deny (fail-closed), not indefinite block.** The interactive registry
   already returns fail-closed deny at zero listeners; both documented schools forbid an in-memory hang.
2. **Default policy = `inherit-allowlist`** (already the spawner literal) — most restrictive value that still
   runs pre-declared work (Claude's `allowedTools` + `dontAsk` locked-down default).
3. **`deny` denies the tool CALL, not the whole task.** A structured deny result returns to the agent loop
   (Claude/OpenAI/LangGraph all feed the reason back); whole-task failure is only the emergent result of the
   agent being unable to proceed. The state-machine `PERMISSION_DENIED → failed` path is reserved for a
   `prompt` a human explicitly denies.
4. **`disallowedTools` always wins** over `allowedTools`/`preapproved`/`inherit-allowlist` (an explicit block
   is absolute — matches "deny beats allow").

## What (implementation)

**Enforcement seam (corrected at GATE-APPROVAL — proposal-reviewer REVISE).** A spawned background/subagent
does NOT reach `session-prompt-registry.requestPermission` directly. Its tool-permission gate is
`PermissionEnforcer.checkPermission` (`packages/agent-session/src/permission-enforcer.ts:210-255`), assembled
by `packages/agent-framework/src/assembly/create-subagent-session.ts:164-181`. That gate runs
`evaluatePermission(toolName, toolArgs, mode, {allow, deny})` (`agent-core/permission-gate.ts`) →
`'auto' | 'deny' | 'approve'`; **`'auto'` returns `true` WITHOUT consulting `permissionHandler`** — only
`'approve'` reaches the handler (→ the registry). Hooking policy "before the interactive request" would gate
ONLY the `approve` branch, so `deny`/`preapproved` would leak whenever the session mode auto-allows (e.g.
`bypassPermissions`). Enforcement must sit at/before `checkPermission`'s FIRST decision and be able to be MORE
restrictive than the session mode.

1. **Pure resolver in `agent-core`** (beside `evaluatePermission`, the permission-logic SSOT) — not
   `agent-executor` (which has no tool loop). `resolvePermissionByPolicy(policy, toolName, {taskAllow,
taskDeny, parentAllow, parentDeny}) → 'allow' | 'deny' | 'prompt'`. `inherit-allowlist` inherits the
   **parent session** rules (`parentAllow`/`parentDeny`), NOT the task's own two lists (else the value is
   misnamed); `preapproved` uses the task-declared `taskAllow`; only `policy: 'prompt'` yields `'prompt'`.
   **Dependency-direction correction** (agent-interface-transport → agent-core is one-way, so core cannot
   import the union from transport): move the `TBackgroundPermissionPolicy` SSOT DOWN to `agent-core` and have
   `agent-interface-transport` import + re-export it (same pattern as `TUniversalValue`). Single SSOT, respects
   dep direction, consumer import paths unchanged.
2. **Enforce once at the subagent-session assembly** (`create-subagent-session`): compose the task policy into
   the child `Session`'s permission configuration so it is evaluated at/before `checkPermission`'s first
   decision and overrides the `auto` branch —
   - `preapproved` → `permissions.allow = taskAllow`, `permissions.deny = taskDeny`, mode whose unknown-tool
     fallback is deny;
   - `deny` → catch-all deny of privileged calls, returning structured `PERMISSION_DENIED` feedback (task
     continues; not force-fail);
   - `inherit-allowlist` → seed from `parentConfig.permissions` (matched→auto, unmatched→deny, never approve);
   - `prompt` → route unknowns to `'approve'` → the existing `permissionHandler` (fail-closes on no surface).
     Reuse `evaluatePermission`; do NOT add a parallel gate.
3. **Close the plumbing on the real path.** The decisive drop is `subagent-manager.ts:206`
   `toSubagentStartRequest` (and `ISubagentSpawnRequest`) which OMIT `permissionPolicy` entirely — add the
   field there and thread it through `createSubagentBackgroundRunner`. Also stop the drops at
   `execution-workspace-spawner.ts:113` / `subagent-manager.ts:131`. Enforce once at convergence, not per
   entry point.
4. **Note the already-partial enforcement.** `disallowedTools`/`allowedTools` are already structurally applied
   via `filterTools` (`create-subagent-session.ts:101-126` — the disallowed tool is physically removed). The
   genuinely unenforced dimension is the **policy MODE** (`deny` / `prompt` / inherit-unmatched) relative to
   the session permission mode; target that gap, do not duplicate tool-list filtering.

## Test Plan

- Unit (`agent-core`): `resolvePermissionByPolicy` truth table — `deny`→deny; `preapproved` allow-on-taskAllow
  / deny-off-list; `prompt`→prompt; `inherit-allowlist` allow-on-**parent**Allow / deny-on-miss / deny-on
  parentDeny; `taskDeny`/`parentDeny` overrides `preapproved` + allow.
- Integration (`agent-framework`): a spawned subagent under each policy resolves a privileged tool call as
  specified AT `PermissionEnforcer.checkPermission` — **including the auto/bypass branch**: `deny` blocks a
  tool the session mode would otherwise `auto`-allow; `preapproved` allows only its declared set; `prompt`
  with no surface fail-closes to deny.

## User Execution Test Scenarios

- **agent-executable.** Live background/subagent task with `permissionPolicy: 'deny'` spawned under a session
  mode that would AUTO-allow the tool (e.g. permissive/bypass mode) → its privileged tool call is still
  blocked (measured) — proving the fix covers the `auto` branch, not just `approve`. Re-run with
  `'preapproved'` naming that tool → it passes; a tool NOT in the set → denied. `'prompt'` with no attached
  surface → fail-closed deny (no hang).
- Evidence: `.agents/evals/scenarios/core-025-permission-policy-enforcement-agent-run.md` (executed 2026-07-21;
  7/7 enforcement tests green under `bypassPermissions`, 6-package full-path build green).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-21

- Prior Art Research: substantiated (`prior-art-researcher`: Claude Code permission modes / Agent SDK
  precedence, OpenAI Agents HITL, LangGraph interrupts) → `PRIOR_ART_RESEARCH: FOUND`; scan-spec-research green.
- Frontmatter (status/type SECURITY/tags + capability keys): present.
- Enforcement semantics refined by prior art (inherit-allowlist unmatched→deny; deny is call-scoped).

### [GATE-APPROVAL] — ✅ PASS | 2026-07-21

Independent `proposal-reviewer`: **REVISE → resolved**. Reviewer ENDORSED the Decision/semantics (four-value
table, deny>prompt>allow precedence, fail-closed, default = inherit-allowlist) but REVISE'd the enforcement
seam. All findings applied to "What":

1. **Wrong seam corrected** — a spawned subagent's tool gate is `PermissionEnforcer.checkPermission`
   (agent-session), assembled by `create-subagent-session` (agent-framework), NOT the interactive registry.
   `evaluatePermission`'s `'auto'` branch bypasses `permissionHandler`, so the old "before the interactive
   request" hook would leak `deny`/`preapproved` under an auto-allow/bypass mode. Enforcement moved to
   at/before `checkPermission`'s first decision, able to be MORE restrictive than the session mode.
2. **Resolver relocated to `agent-core`** (beside `evaluatePermission`), signature takes parent+task rules;
   `inherit-allowlist` inherits `parentConfig.permissions` (not the task's own lists).
3. **Real plumbing drop identified** — `ISubagentSpawnRequest` / `toSubagentStartRequest:206` omit
   `permissionPolicy`; thread it there (not just spawner:113 / subagent-manager:131). Enforce once at convergence.
4. **filterTools note** — allow/disallow lists are already structurally applied; the real gap is the policy
   MODE vs session mode.
5. **agent-run scenario strengthened** — MUST exercise the `auto`/bypass branch (deny blocks a tool the mode
   would auto-allow), else the scenario passes while the hole remains.

Owner directive ("모든 남은 백로그 ... 사전 승인" / "다해줘") = standing GATE-APPROVAL sign-off; REVISE resolved.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-21

Two increments on `feat/core-025-permission-policy-enforcement`:

1. `01b70ba1b` — pure `resolvePermissionByPolicy` in `agent-core` (beside `evaluatePermission`; shared
   `matchesAnyPattern` matcher) + moved the `TBackgroundPermissionPolicy` SSOT down to agent-core
   (transport re-exports; consumer import paths unchanged — respects the one-way transport→core dep). 9 unit tests.
2. `e6111dd08` — enforcement at `PermissionEnforcer.checkPermission`: policy resolved BEFORE the mode gate
   (allow→true, deny→false, prompt→shared `promptForApproval`), closing the `auto`/bypass hole. Policy +
   task allow/deny threaded through `Session`/enforcer options, `ISubagentSpawnRequest` +
   `toSubagentStartRequest` (the dropped path), `createSubagentSession`, and BOTH the in-process and
   child-process subagent runners; `toBackgroundRequest` threads the caller policy instead of the literal.

### [GATE-VERIFY] — ✅ PASS | 2026-07-21

- 6-package full-path build green (agent-core → transport → agent-session → agent-executor → agent-framework
  → agent-subagent-runner).
- 7 enforcement integration tests at the real gate under `bypassPermissions` (deny blocks; preapproved/inherit
  gate by task/parent allowlist; parent-deny > allow; prompt fail-closes / routes to handler; no-policy leaves
  bypass unchanged) + 9 resolver unit tests + 35 permission tests total, no regression.
- Agent-run scenario executed (see User Execution Test Scenarios) — the load-bearing auto/bypass-override case
  proven at the seam every spawn route converges on.
