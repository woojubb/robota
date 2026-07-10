---
status: in-progress
type: INFRA
tags: [remote-control, security, commands, transport]
parent: REMOTE-001
---

# REMOTE-003: Stage B1 — gate remote-origin commands (invocation source + enforcement)

Parent design: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Stage A shipped
([REMOTE-002](../done/REMOTE-002-stage-a-transport-protocol-webrtc-skeleton.md), done). Stage B is decomposed,
**hardening-first** (owner decision, 2026-07-10): **B1 = command-verb gating** → B2 signaling client + relay
auth/rate-limit + discharge `CVE-2024-29415` → B3 SPAKE2 pairing + QR + DTLS-fingerprint binding → B4
`/remote-control` command + registry wiring (the enable path ships last). This spec is **B1** — the security
precondition, independently valuable because it also closes the same hole on the existing WebSocket transport.

## Problem

The `command` client message (`packages/agent-transport-protocol/src/ws-protocol.ts:24`,
`{ type: 'command'; name; args? }`) flows through `createWsHandler` straight into the session with **no
permission check**:

- `packages/agent-transport-protocol/src/ws-handler.ts:232-250` calls `session.executeCommand(msg.name, msg.args ?? '')`
  and streams back `command_result` — no gating, no origin tagging.
- `packages/agent-framework/src/commands/system-command-executor.ts:49-55` executes `command.execute(session, args)`
  directly. `resolveRequiresPermission()` exists (`system-command-executor.ts:44-47`) but is consulted **only** by
  `listModelInvocableCommands()` (line 73) to build descriptors — **never on the execution path**. So a command's
  `requiresPermission`/`safety` metadata (`ISystemCommand`, `command-api/contracts.ts:9-30`) is descriptive, not
  enforced.
- Invocation source is hardcoded `'user'` for every command (`interactive-session-skill-router.ts:169-184`), and
  `TCommandInvocationSource` is `'user' | 'model'` (`command-api/host-context.ts:54`) — there is **no `'remote'`
  origin**.

**Impact:** any transport-origin peer can invoke ANY command (`/shell`, `/editor`, …) with full local-user
authority. The `command` verb is currently **unsent by every in-repo client** (verified: no
`type: 'command'` client message is produced in `packages/`/`apps/`; the local TUI calls
`session.executeCommand` directly at `TuiInteractionChannel.ts:402` / `useSlashRouting.ts:38`, not through the
ws-handler) — so this is a **latent hole**: Stage B's WebRTC enable path (and the existing WebSocket transport)
would open it. The REMOTE-001 design mandates gating remote-origin commands **before** the enable path ships.

## Solution (sub-sequenced, each commit green)

1. **Add the `'remote'` origin — SSOT at the interface layer (Decision D3).** `IInteractiveSession.executeCommand`
   is declared in `agent-interface-transport` (`src/session-contracts.ts`), which may depend **only** on
   `agent-core` (project-structure.md:146; enforced by the `deps`/INTERFACE-DEPS + `interface-imports` scans).
   Threading a framework-owned `TCommandInvocationSource` into that signature would create a prohibited
   `agent-interface-transport → agent-framework` edge. So **relocate the source-type SSOT down to
   `agent-interface-transport`** (alongside the already-relocated command contract family — `ICommandResult`,
   `IInteractiveSession`, per INFRA-010/DATA-001), extend it to `'user' | 'model' | 'remote'`, and **re-export it
   from `agent-framework/command-api/host-context.ts`** so existing framework importers are unchanged. (This is the
   architecturally consistent option; a narrower interface-owned `'user' | 'remote'` origin was the alternative —
   rejected because relocating the full union keeps one SSOT and matches the command-contract precedent.)
2. **Tag transport-origin commands.** Thread an optional `source` into `IInteractiveSession.executeCommand(name,
args, source?)`, **defaulting to `'user'`** so every local caller is unchanged (TUI `TuiInteractionChannel.ts:402`,
   `useSlashRouting.ts:38`). The shared `createWsHandler` (`ws-handler.ts:232-250`) passes `'remote'` — this
   covers **both** the WebSocket and (Stage B4) WebRTC transports, since both are untrusted remote origins.
   Plumb the source through `executeCommand` → `executeCommandWithSource` (`interactive-session-skill-router.ts:186-201`)
   so `commandInvocationSource` reflects the true origin instead of hardcoded `'user'`.
3. **Enforce at the skill router, deny-by-default for remote (Decision D1).** Place a single guard in
   `executeCommandWithSource` (`interactive-session-skill-router.ts`) **before** the
   `if (command.lifecycle === 'blocking')` branch (~`:193`) — this choke point sits above **both** the
   non-blocking (`:197`) and blocking (`executeForegroundCommand`, `:330`) dispatch paths, and above **nothing** on
   the `'model'` path (`executeModelInvocable`, `:207`). Do **NOT** push source into `SystemCommandExecutor` (a
   low-level registry that has no concept of invocation source). The guard, consulted only when
   `source === 'remote'`, permits a command iff it is **read-only** (`this.commandExecutor.resolveRequiresPermission(command) === false`
   — safety `'read-only'` / `requiresPermission: false`) OR explicitly on a **configurable remote-allowlist**.
   Otherwise **DENY**: return an explicit `ICommandResult` error (`"command '<name>' is not permitted from a
remote session"`) and do **NOT** call `command.execute` — never a silent no-op, never execution (no-fallback).
   Local `'user'`/`'model'` sources are unaffected (no new gate on their path).
4. **Scope guard + logged side-channel.** B1 gates the **`command` verb only**. The broader `TClientMessage`
   untrusted-surface audit (the session-drive verbs `submit`/`abort`/`cancel-queue`/… that remote-control intends to
   expose) is scoped to the enable-path substage (B4). **B1 records this audit item so it is not lost:** a remote
   `submit` cannot invoke a slash-command directly (the ws-handler `submit` branch calls `session.submit()` with no
   slash parsing, `ws-handler.ts:229`), **but** it can drive the model to call a `modelInvocable` command, which runs
   under source `'model'` and therefore **bypasses this `'remote'` deny gate**. That path is mediated by
   model-invocability curation + the tool `PermissionEnforcer`, and its hardening belongs to the **B4 submit-surface
   audit** — named here so B4 must address it. B1 does not restrict the drive verbs.

## Affected Files

- `packages/agent-interface-transport/src/*` (new SSOT for the source union — `'user' | 'model' | 'remote'`;
  `IInteractiveSession.executeCommand` optional `source` param in `session-contracts.ts`)
- `packages/agent-framework/src/command-api/host-context.ts` (re-export the relocated `TCommandInvocationSource`)
- `packages/agent-framework/src/interactive/interactive-session-skill-router.ts` (the source-keyed guard in
  `executeCommandWithSource` before the blocking/non-blocking branch + origin plumbing)
- `packages/agent-framework/src/interactive/interactive-session-base.ts` / `interactive-session.ts` (executeCommand
  optional `source` param, default `'user'`)
- `packages/agent-transport-protocol/src/ws-handler.ts` (pass `'remote'` at the `command` branch)
- the remote-command policy module (new; home = composition root, Decision D2) + its wiring in
  `packages/agent-cli/src/startup/command-setup.ts`
- moved-ownership SPEC updates (`agent-interface-transport` gains the source-type; `agent-framework` re-exports);
  changeset

## Completion Criteria

- [x] TC-01: the source union (SSOT now in `agent-interface-transport`, re-exported by `agent-framework`) includes
      `'remote'`; `IInteractiveSession.executeCommand` accepts an optional `source` (default `'user'`); full-repo
      typecheck 0 against all consumers; **`interface-imports` + `deps` scans green** (no
      `agent-interface-transport → agent-framework` edge introduced).
- [x] TC-02: a transport-origin `command` message is executed with source `'remote'` (asserted); local TUI command
      invocation remains source `'user'` and its existing suites pass unchanged.
- [x] TC-03: a **read-only** remote command executes and returns its result; a **non-read-only / non-allowlisted**
      remote command is **DENIED** — an explicit error `ICommandResult` is returned AND `command.execute` is
      **not** called (spy-asserted). No silent no-op.
- [x] TC-04: a command placed on the configured remote-allowlist executes from a remote origin even though it is
      not read-only.
- [x] TC-05: a **blocking-lifecycle** non-read-only remote command is **also DENIED** (the blocking path
      `executeForegroundCommand` is a distinct branch — prove the single guard covers it, not just the
      non-blocking path).
- [x] TC-06: regression — `'user'` and `'model'` sourced commands are unaffected (no new gate applied to them);
      in particular a `modelInvocable` command still runs under `'model'` (the logged B4 side-channel is NOT
      closed by B1).
- [x] TC-07: `pnpm harness:scan` (spec-public-surface for the relocated source-type + extended contract) + affected
      suites (agent-interface-transport, agent-framework, agent-transport-protocol, agent-cli, agent-transport-tui) +
      full-repo typecheck 0; changeset present.

## Test Plan

RED→GREEN. Unit-test the enforcement with a stubbed command registry containing one read-only, one non-read-only,
and one allowlisted command; drive `executeCommand` with each of `'user' | 'model' | 'remote'` and assert the
allow/deny matrix + that `execute` is a spy that is (not) called. Tag-propagation is tested by driving a `command`
`TClientMessage` through `createWsHandler` against a stub session and asserting the recorded source is `'remote'`.
Regression suites for the TUI/local path ride existing tests. harness `spec-public-surface`/`deps`/`interface-imports`
green; changeset.

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — Enforcement seam = skill router.** A single guard in `executeCommandWithSource` before the
  blocking/non-blocking branch (`interactive-session-skill-router.ts ~:193`), consulting
  `commandExecutor.resolveRequiresPermission` + policy. NOT `SystemCommandExecutor` (which owns no source concept and
  is shared by the `'model'` path). Rationale: the router already holds `commandInvocationSource` and both dispatch
  paths funnel through it; the executor does not.
- **D2 — Policy home + default = composition root, deny-by-default (read-only allow + configurable allowlist).**
  The remote-command policy is constructed in `command-setup.ts` and injected into the session/skill-router. Default
  is **deny for non-read-only remote commands**; read-only commands allowed; an explicit allowlist widens.
  Rationale: fail-closed for an untrusted origin. "Read-only allowed" **repurposes** `requiresPermission`/`safety`
  (authored as a local-prompt / model-invocability signal) as a **remote-safety** signal — acceptable **only** under
  REMOTE-001's co-drive model where a paired remote has already passed SPAKE2 (B3) and is an authorized session
  viewer, so read-only exposure (`/context`, `/status`) is within the accepted envelope; the allowlist is the escape
  hatch for the semantic mismatch. A strictly stricter deny-all + explicit-allowlist default was considered (and is
  free since B1 ships no enable path) — read-only-allow is chosen as the pragmatic default and recorded as an
  explicit decision, not an assumption.
- **D3 — Source-type SSOT relocates to `agent-interface-transport`** (re-exported by `agent-framework`), so the
  transport-facing `executeCommand(name, args, source?)` signature is layering-legal. See Solution step 1.
- **D4 — Deny-by-default is sufficient for B1; operator-approval UX deferred to B4.** The design's
  "waiting-for-operator-approval" server message (routing an approval-required remote command to a local TUI prompt)
  is a B4 concern; B1 ships the safe deny gate, B4 may widen via approval.

## Open Questions (for GATE-APPROVAL)

None — all round-1 questions resolved into D1–D4 above.

## Tasks

- [x] Step 1 — relocate the source-type SSOT to `agent-interface-transport` (+= `'remote'`), re-export from `agent-framework`; extend `IInteractiveSession.executeCommand` with optional `source` (default `'user'`); plumb through `executeCommandWithSource`.
- [x] Step 2 — tag transport-origin commands `'remote'` in `createWsHandler`.
- [x] Step 3 — remote-command policy (deny-by-default; read-only allow + configurable allowlist) + the single guard in `executeCommandWithSource` (D1), covering both blocking + non-blocking paths.
- [x] Step 4 — wire the policy in the composition root (`command-setup.ts`, D2); moved-ownership SPEC updates + changeset.
- [x] Step 5 — verify: allow/deny matrix (incl. blocking-lifecycle TC-05) + model-source regression (TC-06); harness:scan (interface-imports/deps/spec-public-surface) + typecheck + changeset.

## Evidence Log

- 2026-07-10 GATE-DRAFT — authored from REMOTE-001 Stage B decomposition (owner chose 4 hardening-first
  sub-stages). Grounding verified against code: the `command` verb is ungated (`ws-handler.ts:232-250` →
  `system-command-executor.ts:49-55`, `resolveRequiresPermission` unused on the exec path), source hardcoded
  `'user'` (`interactive-session-skill-router.ts:169-184`), no `'remote'` origin (`host-context.ts:54`); the
  `command` verb is unsent by all in-repo clients and the local TUI bypasses the ws-handler — so deny-by-default
  has no breaking impact. Pending proposal-reviewer ENDORSE.
- 2026-07-10 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction + chosen alternative endorsed; all
  three load-bearing premises verified TRUE). Four corrections folded in: (1) **D3 layering fix (core)** — the
  original "SSOT stays agent-framework" was incompatible with threading the type into the interface-layer
  `executeCommand`; SSOT relocated to `agent-interface-transport` (re-exported by `agent-framework`), which matches
  the INFRA-010/DATA-001 command-contract precedent and keeps `interface-imports`/`deps` green. (2) **D1** — commit
  the guard to the skill router's `executeCommandWithSource` (above both blocking + non-blocking dispatch, off the
  `'model'` path), not `SystemCommandExecutor`; added TC-05 for the blocking branch. (3) **D2** — record the
  read-only-allow rationale (paired-remote-is-authorized-viewer; `requiresPermission` repurposed as remote-safety
  with the allowlist as escape hatch) as an explicit decision vs the free stricter deny-all default. (4) **Logged
  the model-invocation side-channel** — remote `submit` → `modelInvocable` command runs under `'model'` and bypasses
  the `'remote'` gate; named for the B4 submit-surface audit (TC-06 asserts B1 does not close it). Re-review → round 2.
- 2026-07-10 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All 6 load-bearing premises verified TRUE
  against code (executeCommand declared in `agent-interface-transport/session-contracts.ts:198`, deps = agent-core
  only; `ICommandListEntry` precedent already relocated + re-exported from `host-context.ts`; both blocking +
  non-blocking dispatch funnel through `executeCommandWithSource` while `'model'` uses a separate `executeModelCommand`
  path; no implementation package imports `TCommandInvocationSource`, so the framework re-export introduces no
  `interface-imports` violation). All four round-1 corrections folded in + internally consistent; no new rule
  conflict. Minor non-blocking note (adopted for implementation): the relocated source union's concrete home is
  `agent-interface-transport/src/command-contracts.ts` (already imported by `session-contracts.ts:23`, avoiding a
  circular import), consumed by `session-contracts.ts` for the `executeCommand` param. Design APPROVED → implement.
  Spec → active.
- 2026-07-10 GATE-IMPLEMENT — B1 built per D1–D4. `TCommandInvocationSource` SSOT moved to
  `agent-interface-transport/src/command-contracts.ts` (+= `'remote'`), re-exported from
  `agent-framework/command-api/host-context.ts`; `IInteractiveSession.executeCommand` gained optional `source`
  (default `'user'`) threaded through base/session/skill-router. `createDefaultRemoteCommandPolicy` +
  `IRemoteCommandPolicy` added (deny-by-default: read-only allowed + allowlist); the single guard sits in
  `executeCommandWithSource` before the blocking branch. `createWsHandler` tags the `command` verb `'remote'`.
  Policy wired composition-root → session (`command-setup.ts` → `cli.ts` → `renderApp` → `TuiInteractionChannel`;
  print-mode/headless intentionally unwired — one-shot, no transport command surface). Runtime seam also on
  `IAgentRuntimeConfig.remoteCommandPolicy`.
  - **Verification:** new tests green — `remote-command-policy` (3), skill-router `remote-gate` allow/deny matrix
    incl. TC-05 blocking-branch denial + TC-06 user/default regression (6), ws-handler TC-02 `'remote'` tag (28
    protocol tests). Full suites green: agent-framework 1057, agent-transport-tui 418, agent-interface-transport
    10, agent-transport-protocol 28, agent-cli 166. Full-repo `typecheck` 0. `harness:scan` **49/49**
    (`interface-imports`/`deps` green — no interface→framework edge; spec-public-surface updated:
    `createDefaultRemoteCommandPolicy` in agent-framework SPEC, `TCommandInvocationSource` ownership in
    agent-interface-transport SPEC). Changeset added. Lint: 0 errors (2 pre-existing-adjacent line-count warnings,
    tolerated — no `--max-warnings 0`). → GATE-VERIFY.
