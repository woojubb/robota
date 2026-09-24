# agent-transport-http Specification

## Purpose

HTTP transport (Hono) for the Robota SDK, split out of the consolidated `agent-transport` package
so the `hono` dependency is an isolated unit.

## Contract

- Depends on `agent-interface-transport` for transport contracts and on `agent-transport/node` only
  for the transport admission seam (`resolveAdmission`, `bearerCredential`, `credentialMatches`); that
  admission decision is deliberately not re-made here.
- Contract-pure otherwise: the one side concern of where a stream-failure detail goes is injected via
  `IAgentRoutesOptions.onStreamFailure`, never imported.
- No other transport package may depend on this one.

## Invariants

- `createHttpTransport` is a frozen `service` lifecycle: readiness is construction of the
  Hono app (`getApp()`), not binding a network listener. A repeated active start rejects
  `TransportLifecycleError`; repeated stop is safe and supports a new attach/start generation.
- `/submit` refuses a second concurrent turn on a session, keyed by `getSession().getSessionId()`
  rather than object identity — a factory that returns a fresh wrapper per call (proxy, adapter,
  spread copy) is therefore safe, since only the reported session id determines the claim. Two
  sessions that report the same id are treated as one and will 409 each other; that is a contract
  violation upstream, since `getSessionId()` is supposed to name a session.
- A session that cannot name itself cannot be claimed: `/submit` refuses it (HTTP 500) rather than
  falling back to `isExecuting()`, because that fallback would start a turn this route cannot
  guarantee belongs to the caller. `/executing` is the one place an unnameable session still answers,
  from `isExecuting()` alone — reporting what a session is doing is not the same act as admitting a
  new turn to it.

## Error taxonomy (design intent)

HTTP errors surface as Hono responses; no new error classes are introduced.

- The session's `error` event is relayed verbatim on the SSE `error` channel (its own client-facing
  wording); the WS transport relays it identically.
- An exception escaping the stream callback after headers were sent is not a message composed for the
  client: the client gets a generic line, and the detail goes only to the host's injected
  `onStreamFailure` (absent means the host chose to drop it) — the same withholding the `/submit` 500
  branch practices.
- The callback swallows its own failures rather than passing an `onError` to `streamSSE`, because
  Hono's runner writes an escaped exception's raw message verbatim to the stream on any `onError`,
  which would leak the withheld detail regardless of what the handler intended.

## Non-goals

- Does not bind or manage a network listener.
- Does not re-decide admission; that decision belongs to `agent-transport/node`.
