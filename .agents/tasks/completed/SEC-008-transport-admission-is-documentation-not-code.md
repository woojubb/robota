---
title: 'SEC-008: the trust boundary is documentation rather than code — two shipped transports have no authentication, two more chose opposite defaults, and the server dev fallback authenticates any three-part string'
status: done
completed: 2026-08-10
created: 2026-08-02
priority: critical
urgency: now
area: packages/agent-transport-http, packages/agent-transport-mcp, packages/agent-transport-webrtc, packages/agent-transport-ws, packages/agent-framework, apps/agent-server
depends_on: []
---

# SEC-008: admission is not a member of any contract, so each transport re-decides it

## Problem

Remote arbitrary tool execution reaches the host with no gate, and a second auth bypass is selected
by a _missing environment variable_. An unauthenticated `POST /submit` looks identical to an
authorized one — the failure is loud in neither direction.

The design premise is written down and coherent: pairing is meant to be the sole trust boundary and
the command policy is therefore allow-by-default. That premise is enforced in two of four remote
transports. The policy layer that _assumes_ a boundary exists has no way to require one.

## Evidence

Observed independently by **L3 (transport)** and **L4 (product)**.

- L3 F2 — the design premise:
  `packages/agent-framework/src/commands/remote-command-policy.ts:5-9` — _"pairing (Stage B3) is the
  sole trust boundary … So this policy is allow-by-default."_
  - **WS, secure by default and well built:** `agent-transport-ws/src/ws-transport-configurable.ts:116-122`
    auto-mints a token unless `open: true`; `:237-240` closes with 1008 _before_ the `messages` send
    at `:271-275`; `verifyClient` at `:217-230` rejects a disallowed `Host`/`Origin` at the upgrade.
  - **WebRTC, insecure by default:** `agent-transport-webrtc/src/webrtc-transport.ts:49`
    `readonly secret?: string`, gated at `:194`; without it `:211-227` wires `createWsHandler`
    straight onto the data channel. Two sibling transports made **opposite** default choices for one
    decision.
  - **HTTP, no gate at all:** `agent-transport-http/src/routes.ts:33-166` installs no middleware;
    `POST /submit` reaches `session.submit(body.prompt)` at `:102`, `POST /command` reaches
    `session.executeCommand` at `:121`. The absent boundary is stated nowhere —
    `agent-transport-http/docs/SPEC.md:37-39` says only _"no new error classes"_.
  - **MCP, no gate and it strips the origin tag:** `agent-transport-mcp/src/mcp-server.ts:64-77`
    registers **every** command from `session.listCommands()` as callable, and `listCommands()`
    (`interactive-session-skill-router.ts:130-137` over `system-command-executor.ts:57-60`) drops
    `modelInvocable`/`userInvocable`/`safety`/`requiresPermission` — so `modelInvocable: false`
    commands (e.g. `plugin`, `agent-command/src/plugin/plugin-command-module.ts:19,31`) become
    model-callable. `mcp-server.ts:106` calls `executeCommand` **with no `source`**, defaulting to
    `'user'`, so a remote peer is attributed as the local operator and the `'remote'` policy seam is
    bypassed.
- L4 L1 — `apps/agent-server/src/websocket-server.ts:181-198`: with `JWT_SECRET` unset the string
  `"a.b.c"` authenticates as any `userId`/`sessionId`; the constructor logs a warning at `:69-75` and
  serves anyway. And even the verified path discards `jwt.verify`'s return — `client.userId` /
  `client.sessionId` at `:201-202` come from the _message body_, so any holder of any valid token can
  claim another user's session and reach `broadcastToSession` (`:271-291`).
- L4 L2 — `apps/agent-server/src/app.ts:115-138` registers `/api/v1/remote/chat` with no auth over
  providers built at `:92-108` from the **operator's** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
  `GEMINI_API_KEY`; the only control is a global IP rate limiter (`:68-83`).

The cause in one sentence, from the synthesis: _admission is not a member of any contract, so each
transport re-decides it — with opposite defaults — and the policy layer that assumes a boundary
exists has no way to require one._

## Why this is foundational (or not)

**Both, and the synthesis records that the two reports are describing different halves:**

- **FOUNDATIONAL** for the missing admission seam (L3). No contract requires admission, so a new
  transport can ship without one and nothing mechanical notices.
- **LOCAL** for the two `apps/agent-server` defects (L4). Those are fixable in place.

The synthesis states both readings are correct. It also carries a **severity caveat from L4**: the
severity of the two `apps/agent-server` auth findings _"assumes the server is deployed"_ — the app
carries `firebase.json`, `vercel.json` and deploy scripts — and would drop one band each if it is
not. The synthesis kept them at blocker/high because _the code is the thing that would be deployed_,
while noting that **the deployment status is a fact worth establishing before sequencing this work**.

Relationship to the transport contract: the synthesis's finding on `ITransportAdapter` (see
ARCH-011) names this finding as one of its consequences — the missing admission axis is one of the
axes that contract omits. This Task is not blocked on ARCH-011 (the `agent-server` half is
independently fixable), but the seam half should be sequenced with it.

## Direction

The invariant the synthesis states for this class (theme T3): _an admission or containment decision
must be enforced by a mechanism the contract requires, not by a convention each implementation may
or may not follow._

The synthesis names the shape that already works and can be the model: the WS transport
(`ws-transport-configurable.ts:116-122`, `:217-230`, `:237-240`) — auto-mint by default,
opt-out explicitly, reject at the upgrade, and close _before_ any payload send. It names the
opposite default in WebRTC as the defect, not the WS behaviour.

For MCP, two distinct sub-defects: the command list must not strip
`modelInvocable`/`userInvocable`/`safety`/`requiresPermission`, and `executeCommand` must not default
the call `source` to `'user'` for a remote peer.

For `apps/agent-server`: the JWT fallback must not admit on format alone, and the authenticated
identity must come from `jwt.verify`'s return rather than the message body.

Risk named by the synthesis: the two sibling transports made **opposite** choices for one decision,
so any fix that only patches the insecure ones leaves the decision still un-owned — the next
transport re-decides it again.

## Test Plan

- **Required red-first regression:** a test that issues `POST /submit` to the HTTP transport with no
  credential and asserts a rejection before `session.submit` is reached
  (`agent-transport-http/src/routes.ts:102`). Against current code this must FAIL — today the route
  has no middleware and the prompt executes.
- Red-first for MCP: assert that a command with `modelInvocable: false` (e.g. `plugin`,
  `plugin-command-module.ts:19,31`) is **not** registered as callable by `mcp-server.ts:64-77`, and
  that `executeCommand` is invoked with a `'remote'` source rather than the default `'user'`
  (`mcp-server.ts:106`).
- Red-first for WebRTC: assert that constructing the transport without `secret`
  (`webrtc-transport.ts:49`) does not wire `createWsHandler` onto the data channel (`:211-227`).
- Red-first for `apps/agent-server`: assert `"a.b.c"` is rejected with `JWT_SECRET` unset
  (`websocket-server.ts:181-198`), and that `client.userId`/`client.sessionId` (`:201-202`) are taken
  from the verified token, not the message body.
- A parity check over all transports so a new one cannot ship with no admission answer.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** The change is observable on a shipped product surface: what an unauthenticated remote
request to a running Robota transport does.

- **Prerequisites:** built `robota` CLI; a provider key configured. The scenario needs a locally
  served transport — this environment already exists (the CLI can serve the HTTP transport); no new
  fixture is required.
- **Steps:**
  1. Start the CLI serving the HTTP transport on loopback.
  2. From a second shell, issue `POST /submit` with a prompt body and **no** credential.
  3. Repeat with the credential the CLI minted at startup.
- **Expected observable result (after the fix):** step 2 is rejected with an authentication error and
  the prompt is never executed — nothing appears in the session transcript. Step 3 succeeds.
- **Expected observable result (before the fix, for contrast):** step 2 executes the prompt and is
  indistinguishable from step 3.
- **Cleanup:** stop the served transport.
- **Evidence:** run by the agent on 2026-08-10 —
  [`.agents/evals/scenarios/sec-008-transport-admission-agent-run.md`](../../evals/scenarios/sec-008-transport-admission-agent-run.md).
  Served over a real loopback socket: step 2 (no credential) answered **401
  `{"error":"unauthorized"}`** with the session transcript **empty** — the prompt never reached
  `session.submit`; step 3 (with the minted 64-char credential) answered **200** with the SSE
  `complete` event and exactly that one prompt in the transcript. The contrast case
  (`admission: { open: true, openReason: … }`) answered **200 with no credential** and executed the
  prompt, which is what the absent gate used to do for every caller.

## Resolution

**The work had already landed; this Task was stale at `status: todo`.** Verified item by item on
2026-08-10 rather than assumed:

| Test Plan item                                                         | State on `develop`                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP `POST /submit` gated before `session.submit`                      | `IHttpTransportOptions.admission`; omission means SECURE (mints a credential). Covered by `packages/agent-transport-http/src/__tests__/`.                                                              |
| MCP must not strip `modelInvocable`/`safety`…                          | `mcp-server.ts:70` — `if (!cmd.modelInvocable) continue;`. Covered by `remote-command-admission.test.ts`.                                                                                              |
| MCP must not default the call source to `'user'`                       | `mcp-server.ts:150` — `executeCommand(cmdName, args, 'remote')`. Same test file.                                                                                                                       |
| WebRTC must not wire the channel without a secret                      | `webrtc-transport.ts` resolves admission; a `secret` with `open: true` is refused as contradictory. Covered by `admission-secure-by-default.test.ts`.                                                  |
| `apps/agent-server` JWT fallback + identity from the verified claim    | `authenticate-playground-client.ts` (a pure function, so the transport cannot reach past it) with `authenticate-playground-client.test.ts` asserting `"a.b.c"` is rejected when `JWT_SECRET` is unset. |
| A parity check so a new transport cannot ship with no admission answer | `scripts/harness/scan-transport-admission.mjs` — passes, `::examined:: 9 transport package(s)`.                                                                                                        |

Suites re-run for this closure: **10 files / 73 tests green**. The one item that was genuinely
outstanding was the **user-execution evidence**, which the scenario section had left as
"fill in after implementation" — it is now filled from an agent-run, above.

The FOUNDATIONAL half named in "Why this is foundational" — making admission a member of the
transport contract itself rather than a per-transport decision — is what
`scan-transport-admission.mjs` now enforces mechanically: the parity check is the mechanism that
stops the next transport from re-deciding it. The contract-level axis on `ITransportAdapter` remains
ARCH-011's subject, as this Task's own note said it should be.
