# SEC-008 — an unauthenticated remote request reaches no session (agent-run evidence)

The user-execution scenario from
[SEC-008](../../tasks/completed/SEC-008-transport-admission-is-documentation-not-code.md), run by the
agent against the built `@robota-sdk/agent-transport-http` package on 2026-08-10.

## S-SEC008-1 — `POST /submit` with and without the minted credential

**Fixture:** the shipped `createHttpTransport()` served over a REAL loopback socket
(`node:http` server delegating to the transport's Hono app), so both calls below are real HTTP and
not an in-process `app.fetch()` shortcut. The session attached to it is a stand-in that RECORDS every
prompt it receives — the transcript is the observable the scenario asks for ("the prompt is never
executed"). Two facts of the session contract had to be honoured for the run to be meaningful, and
each was discovered by the transport refusing rather than guessing:

- `getSession().getSessionId()` — without it `/submit` answers **500**, refusing to key a
  concurrent-turn claim by a racy global flag (RUNTIME-003). A guard, working.
- a terminal `complete` event — the SSE stream ends on it; a session that never emits one leaves the
  request hanging (measured: the first run timed out here).

`admission` is OMITTED, which is the shipped default and means SECURE: the transport mints a
credential at construction and `getAdmissionToken()` returns it for the host to hand to its client.

**Observed:**

| Step                                  | Status  | Body                                     | Session transcript         |
| ------------------------------------- | ------- | ---------------------------------------- | -------------------------- |
| 2 — `POST /submit`, **no** credential | **401** | `{"error":"unauthorized"}`               | **empty — never executed** |
| 3 — same, with the minted credential  | **200** | `event: complete` / `{"success":true,…}` | exactly the step-3 prompt  |

The minted token was 64 characters; step 2 never reached `session.submit`, so the transcript after
both calls holds one entry and it is the authenticated one.

## Contrast — what an ungated transport does with the same request

The pre-fix state (no gate at all) no longer exists on `develop`, so the honest analogue is the state
a host must now ASK for — and asking takes a reason it has to write down (`openReason`, enforced;
`open: true` together with a token is refused as contradictory).

| Configuration                                               | Status  | Admission token | Session transcript  |
| ----------------------------------------------------------- | ------- | --------------- | ------------------- |
| `admission: { open: true, openReason: '…' }`, no credential | **200** | `null (open)`   | prompt **executed** |

So the difference between "reaches the host with no gate" and "rejected before the session" is the
admission decision itself — which is now made by omission being SECURE, and reachable only by an
explicit, explained opt-out.

## How to re-run — the scenario is CODE, not a report of a run

The first version of this file described a run whose runner was not checked in. Review named the
irony: SEC-008 is about a trust boundary that is documentation rather than code, and its closing
evidence was documentation rather than code. So the scenario lives in the suite, where anyone can
re-run it and where CI runs it on every change:

```bash
npx vitest run packages/agent-transport-http/src/__tests__/admission-loopback-scenario.test.ts
# 3 passed — the three rows above, over a real loopback socket
```

It is deliberately not an `app.fetch()` test like its siblings: the claim is about what an
unauthenticated **remote request** does to a **served** transport, so the request actually travels
over a socket. And the assertion is the session TRANSCRIPT, not just the status code — "answered
401" and "never executed" are different claims, and only the second is the security property.

Mutation-proved: constructing the transport with `admission: { open: true, … }` in the first case
makes it fail on `the unauthenticated prompt reached the session`, so the case is guarding the gate
rather than the status code.

The surrounding suites remain the coverage for the other three transports and the server:

```bash
npx vitest run packages/agent-transport-http/src/__tests__ \
  packages/agent-transport-mcp/src/__tests__ \
  packages/agent-transport-webrtc/src/__tests__/admission-secure-by-default.test.ts \
  apps/agent-server/src/__tests__/authenticate-playground-client.test.ts

node scripts/harness/scan-transport-admission.mjs
# ::examined:: 9 transport package(s) — transport-admission scan passed
```
