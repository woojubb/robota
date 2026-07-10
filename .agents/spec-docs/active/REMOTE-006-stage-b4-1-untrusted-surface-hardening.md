---
status: in-progress
type: INFRA
tags: [remote-control, security, commands, transport]
parent: REMOTE-001
---

# REMOTE-006: Stage B4-1 — unify local/remote authority (neutralize the remote-command discrimination)

Parent: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Prior sub-stages done:
REMOTE-002 (A), 003 (B1), 004 (B2), 005 (B3).

**Owner principle (2026-07-11, supersedes the B1 framing): local and remote are the SAME layer — do not
discriminate.** Pairing (B3) is the **sole trust boundary**; once a peer completes pairing it is the session
**owner**, identical to the local operator. Past that boundary, capability is governed **uniformly** by the
existing, transport-neutral permission system (permission modes + `PermissionEnforcer` + the ask/approval handler)
— exactly as for a locally-driven turn. There is no "remote is less trusted" tier.

This reframes Stage B4. A round-2 review of the previous (now-discarded) "remote-surface hardening" plan surfaced
why the old framing was incoherent: B1 (REMOTE-003) gated the remote `command` verb deny-by-default, but the
model's **tools** (`Bash`/`Write`/`Edit`) and **skills** (`/skills <skill>` fan-out) are the dominant
side-effecting routes and were NOT gated — so a remote peer denied `/shell` could just ask the model to run
`Bash`. Under the owner principle the resolution is not to also gate tools/skills by origin (more discrimination)
but to **remove the discrimination**: the paired peer is the owner, and the ONE universal permission system already
governs dangerous tools/commands/skills for every driver. This item makes B1 neutral; the transport-neutral
permission/ask flow and the `/remote-control` enable path are the subsequent B4 items (REMOTE-007+).

## Problem

REMOTE-003 (B1) added a `'remote'` `TCommandInvocationSource` and a **deny-by-default** `remoteCommandPolicy`
(`packages/agent-framework/src/commands/remote-command-policy.ts`): a transport-origin `command` runs only if
read-only or allowlisted. That is a local/remote **discrimination** the owner rejects, and it is **incoherent**:

- It gates the `command` verb but not the model's built-in **tools** (`create-tools.ts` wires `Bash`/`Shell`/
  `Write`/`Edit` as model-callable; `shell-tool.ts` spawns a child process) — a remote-driven `submit` reaches
  arbitrary shell via `Bash` without touching a command (round-2 finding).
- The read-only `skills` command (`safety:'read-only'`) fans out to arbitrary shell/fork/inject skills, so even
  the command gate is bypassable via `/skills <skill>`.
  Gating one narrow channel while the wide ones stay open is security theater; the coherent model is one uniform
  permission system for all drivers, with **pairing as the trust boundary**.

## Solution (sub-sequenced, each commit green)

1. **Neutralize the gate COMPLETELY — both deny-by-default layers (D1).** The deny-by-default lives in **two**
   places and both must flip so a `'remote'` command behaves exactly like a locally-typed one:
   - **Factory default:** `createDefaultRemoteCommandPolicy()` (empty allowlist) → **allow** (was read-only-only).
   - **Router no-policy fallback** (`interactive-session-skill-router.ts:209`,
     `this.remoteCommandPolicy ? policy.isAllowed(...) : readOnly`) → **allow** when no policy is injected (was
     `: readOnly`, which kept denying for any `agent-framework` consumer that injects no policy).
     The **injection seam remains** (`IRemoteCommandPolicy`) as an **optional, user-configured** restriction for
     anyone who wants to constrain a driver — off by default, origin-neutral in intent, NOT a built-in remote tier.
     The `'remote'` source tag stays (harmless; attribution/telemetry + the optional seam) but no longer denies by
     default. (The `source==='remote'` branch may stay for now with both its defaults flipped to allow, or be
     collapsed to a uniform `policy?.isAllowed(name, readOnly, source) ?? true`; either yields local==remote by
     default — pick one and keep the code and the `remoteCommandPolicy` name self-consistent.)
2. **Record the universal principle in the REMOTE-001 design.** Add: pairing (B3) is the sole trust boundary;
   local == remote past it; capability is governed by the universal permission system (modes + `PermissionEnforcer`
   - ask handler), which must become transport-neutral (REMOTE-007) so a remote owner answers their OWN prompts.
     Mark the B1 remote-command-gate framing SUPERSEDED and record the tool/skill-were-never-gated finding as why the
     discrimination is dropped rather than extended.
3. **Reachability is corrected, not "test-only" (D3).** `WsTransport.defaultEnabled = true`
   (`ws-transport-configurable.ts:28`) and `TransportRegistry.startAll` runs it every interactive session
   (`TuiInteractionChannel.ts:234`), so a **localhost WS** server is already live on `127.0.0.1:7070` with no
   pairing check, producing `source==='remote'` for any localhost client. So this neutralization is **immediately
   effective on the localhost WS `command` path** (defensible: a localhost client is the local operator, and
   `submit` there is already ungated → no NEW exposure). The genuinely-remote **WebRTC** path still requires
   pairing (B3) to connect and is NOT registered in the CLI — it stays pairing-gated and unwired. B4-1 ships no new
   enable path.
4. **REMOTE-007 gate (D4).** The future enable path for the genuinely-remote (WebRTC/pairing) surface MUST NOT
   ship before the transport-neutral permission/ask flow — otherwise an allow-by-default remote command could
   execute with **no owner present to answer its permission prompt**. Recorded as a hard precondition on B4-2.

## Affected Files

**Behavior (D1):**

- `packages/agent-framework/src/commands/remote-command-policy.ts` (factory default → allow)
- `packages/agent-framework/src/interactive/interactive-session-skill-router.ts` (flip the `:209` no-policy fallback → allow)

**Doc self-consistency (D2) — sweep EVERY stale "deny-by-default"/"only read-only remote commands allowed" claim (each becomes false after D1). Affected packages: agent-framework, agent-interface-transport, agent-cli, agent-transport-tui, agent-transport-protocol:**

- `agent-interface-transport/src/command-contracts.ts:16` (**SSOT** — "gated by a deny-by-default policy") + `session-contracts.ts:203`
- `agent-framework/src/commands/remote-command-policy.ts` docblock (~:1-14) + the `:26` "Default deny-by-default policy" JSDoc + `docs/SPEC.md:161` (**drop "deny-by-default"**)
- `agent-framework/src/interactive/interactive-session-skill-router.ts:94` (field comment) + `:201` (guard comment "deny-by-default")
- `agent-framework/src/interactive/interactive-session-options.ts:76-78`
- `agent-framework/src/runtime/agent-runtime.ts:30` ("Absent → only read-only remote commands allowed" — becomes the OPPOSITE of the truth)
- `agent-cli/src/startup/command-setup.ts:66-68` + `:123`
- `agent-transport-tui/src/TuiInteractionChannel.ts:78` + `render.tsx:52` (identical sibling docstring)
- `agent-transport-protocol/src/ws-handler.ts:237-238`
- test comments: `remote-command-policy.test.ts:9`, `interactive-session-skill-router.remote-gate.test.ts:10`, `ws-handler.test.ts:299`
- (`dist/**` d.ts hits regenerate on build — no manual edit.)

**Tests + design:**

- `agent-framework/src/commands/__tests__/remote-command-policy.test.ts` + the skill-router remote-gate test (assert the new neutral default incl. the **no-policy** framework default; keep the seam-restricts-when-configured case)
- `.agents/spec-docs/todo/REMOTE-001-…` design (universal principle + B1 SUPERSEDED + REMOTE-007 gate) + `.agents/spec-docs/done/REMOTE-003-…` Evidence
- changeset

## Completion Criteria

- [x] TC-01: `createDefaultRemoteCommandPolicy()` (no args) now **permits** a non-read-only command from a
      `'remote'` origin (previously denied) — local == remote by default.
- [x] TC-02: **no-policy framework default** — the skill router with `remoteCommandPolicy === undefined` now
      **allows** a `'remote'` non-read-only command (the `:209` fallback flip; previously denied). This is the gap
      the factory-only flip missed.
- [x] TC-03: an explicitly-configured restrictive policy (the optional seam) still restricts as before — the seam
      is intact for a user who opts in.
- [x] TC-04: local (`'user'`) + `'model'` paths unchanged (regression); no gate denies a default-config remote
      command.
- [x] TC-05: **repo-wide** grep over `packages/*/src` + `packages/*/docs` (excluding `dist/`) asserts **zero**
      "deny-by-default" / "only read-only remote commands allowed" occurrences tied to the remote-command policy —
      so the test enforces D2 across all packages, not just a hand-picked file list.
- [x] TC-06: REMOTE-001 design records the universal principle + B1 SUPERSEDED note + the REMOTE-007 permission-gate
      precondition; REMOTE-003 Evidence records the neutralization.
- [x] TC-07: `pnpm harness:scan` + affected suites (agent-framework, agent-transport-protocol) + full-repo
      `pnpm typecheck` 0; changeset present.

## Test Plan

RED→GREEN: flip the policy-default tests (remote non-read-only now allowed by default), keep an explicit-restrictive
policy test (seam works), regression the local/model paths + the B1 command-tag plumbing (still tags `'remote'`,
just no longer denies by default). harness + typecheck + changeset.

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — neutralize BOTH deny-by-default layers** (factory default AND the router `:209` no-policy fallback), not
  just the factory; add a no-policy-default TC (the gap the factory-only flip missed).
- **D2 — keep the neutralized `'remote'` plumbing** over a full REMOTE-003 revert (attribution + optional seam; no
  capability gain from removing it). The `remoteCommandPolicy` name is kept for now (rename deferred), but code +
  docs must be self-consistent (no lingering "deny-by-default" language).
- **D3 — reachability corrected:** neutralization is immediately effective on the live localhost WS `command`
  path (no NEW exposure — `submit` there is already ungated); the genuinely-remote WebRTC path stays pairing-gated
  - unwired.
- **D4 — REMOTE-007 gate:** the WebRTC enable path must not ship before the transport-neutral permission/ask flow.

## Open Questions (for GATE-APPROVAL)

None — all round-1 questions resolved into D1–D4 above.

## Tasks

- [x] Step 1 — neutralize BOTH layers: `createDefaultRemoteCommandPolicy` factory default → allow AND the skill-router `:209` no-policy fallback → allow; keep the optional seam.
- [x] Step 2 — sweep EVERY stale deny-by-default claim across agent-framework/agent-interface-transport(SSOT)/agent-cli/agent-transport-tui/agent-transport-protocol (+ test comments); verified by the repo-wide TC-05 grep.
- [x] Step 3 — flip/adjust the policy + skill-router tests (incl. no-policy default TC); regression local/model + command-tag plumbing.
- [x] Step 4 — record the universal principle + REMOTE-007 permission-gate in the REMOTE-001 design (B1 SUPERSEDED) + REMOTE-003 Evidence.
- [x] Step 5 — verify: harness:scan + typecheck + changeset.

## Evidence Log

- 2026-07-11 GATE-DRAFT — reframed from the discarded "B4-1 remote-surface hardening" plan after the owner
  principle (local == remote; pairing is the sole boundary; do not discriminate) and a round-2 review that showed
  the old plan was incoherent (tools/skills are the dominant side-effecting routes and were never gated, making
  the command-only gate theater). This item neutralizes the B1 remote-command discrimination (default → allow,
  seam optional) and records the universal principle; the transport-neutral permission flow + the enable path are
  the subsequent B4 items. Pending proposal-reviewer ENDORSE.
- 2026-07-11 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction ENDORSED as the correct realization of
  the owner mandate; premises verified — B1 is deny-by-default + origin-discriminating; tools/skills were never
  gated so neutralizing the command gate removes an inconsistency, opens no new hole). Four completeness gaps
  folded in: (D1) the neutralization must flip **both** deny-by-default layers — the factory default AND the
  router `:209` no-policy fallback (`: readOnly`), else a no-policy `agent-framework` consumer keeps denying;
  no-policy-default TC added. (D2) keep the neutralized plumbing (not a full revert); code+docs self-consistent.
  (D3) the reachability premise was wrong — `WsTransport.defaultEnabled=true` runs a live localhost WS per session,
  so neutralization is immediately effective there (no new exposure; `submit` already ungated), while the
  genuinely-remote WebRTC path stays pairing-gated + unwired. (D4) record the REMOTE-007 precondition (enable path
  must not ship before transport-neutral permission/ask). Mandatory doc edits enumerated (SPEC.md:161 +
  policy/router/options/ws-handler comments). Re-review → round 2.
- 2026-07-11 GATE-APPROVAL round 2 — proposal-reviewer **REVISE** (D1/D3/D4 verified complete + code-accurate; the
  reviewer confirmed the `source==='remote'` execution gate is the **only** deny site — no third layer). Sole gap:
  **D2 doc-sweep was under-scoped** — 6+ more stale "deny-by-default"/"only read-only remote commands allowed"
  claims exist beyond the original 5, including in the **SSOT** package (`agent-interface-transport`
  command-contracts.ts:16 / session-contracts.ts:203) and two that become **affirmatively false** after D1
  (`agent-runtime.ts:30`, `command-setup.ts:66-68/123`), plus `TuiInteractionChannel.ts:78`, skill-router `:201`,
  and 3 test comments. Folded in: Affected Files now enumerates all of them across 5 packages; **TC-05 widened to a
  repo-wide grep** (was a 5-file scope that would pass vacuously); `dist/**` noted as regenerated. Re-review →
  round 3.
- 2026-07-11 GATE-APPROVAL round 3 — proposal-reviewer confirmed D1/D3/D4 intact + the repo-wide TC-05 is a sound
  exhaustive backstop; independent grep of `packages/*/src` = 16 stale occurrences, 15 already enumerated. Two
  mechanical additions folded in (the reviewer's stated ENDORSE condition — "once these are added the enumeration
  matches 16/16 exactly, everything else complete"): `agent-transport-tui/src/render.tsx:52` (identical sibling of
  the listed `TuiInteractionChannel.ts:78`) + the `remote-command-policy.ts:26` "Default deny-by-default" JSDoc.
  Enumeration now matches the actual stale set exactly (16/16), mechanically enforced by the repo-wide TC-05.
  Condition satisfied → **APPROVED** → implement. Spec → active.
- 2026-07-11 GATE-IMPLEMENT — B4-1 built per D1–D4. **Both** deny layers flipped: `createDefaultRemoteCommandPolicy()`
  → allow-all (params removed), and the skill-router gate restructured to `if (source === 'remote' &&
this.remoteCommandPolicy)` so the no-policy path now allows (local == remote). `IRemoteCommandPolicy` kept as the
  optional restriction seam. **D2 doc-sweep: all 16 stale "deny-by-default"/"only read-only remote commands
  allowed" claims neutralized** across agent-framework / agent-interface-transport(SSOT) / agent-cli /
  agent-transport-tui / agent-transport-protocol + test comments (`options.ts:76` initially missed, caught by the
  repo-wide grep + fixed). REMOTE-001 design records the local==remote principle + B1 SUPERSEDED + the REMOTE-007
  permission-transport precondition; REMOTE-003 Evidence records the neutralization.
  - **Verification:** remote-command-policy + skill-router remote-gate suites rewritten to allow-by-default
    (incl. the no-policy framework-default TC-02 and the optional-restrictive-seam TC-03) — 8 green; full
    agent-framework 1056 + agent-cli 166 regression green; agent-transport-protocol 28. **TC-05 repo-wide grep =
    zero stale claims.** `harness:scan` 49/49; full-repo `typecheck` 0; changeset added. → GATE-VERIFY.
