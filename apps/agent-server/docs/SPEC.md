# Agent Server Specification

## Purpose

AI provider proxy server with Playground WebSocket support, deployable standalone or as Firebase
Functions. It fronts provider chat calls (server-key and BYOK), a Playground session/catalog API, and
process lifecycle, while leaving provider semantics and session policy to the packages it wraps.

## Contract

- Host-level composition only: core package contracts (provider, session, Playground protocol) remain
  owned by their respective packages; this app inlines routing, not domain logic.
- The server owns chunk assembly for streaming: the wire carries text deltas plus exactly one terminal
  assembled message per stream — tool-call fragments never cross it, so clients cannot reassemble an
  incomplete or divergent message.
- Streaming responses always end with either `done` or a distinct `error` frame, so a client can never
  mistake a failed stream for a finished one. A request that selects an `effort` receives exactly one
  effort outcome; a stream whose adapter reports zero or several is refused. Request validation happens
  before headers are sent, so a rejected request is an ordinary `400`, never an error disguised as a
  200 response.
- If the client aborts a stream, the server aborts the underlying provider call — work stops at both
  ends rather than continuing at the operator's expense.
- Caller-supplied `tools` and per-call `options` (including `effort`) are validated as untrusted
  network input; an invalid or unsupported value is rejected wholesale with `400`, never partially
  applied, since partial application would silently ignore a caller's request.
- Provider secrets and direct vendor API calls stay server-side. On the Playground routes a BYOK key
  arrives in a dedicated header and is stripped from the request before further handling; the BYOK
  chat route takes the key in the request body, uses it only for that call, and never logs it.
- In production (`NODE_ENV=production`), unexpected failures are answered with generic error details —
  internal paths and storage errors are not exposed. Other environments return the raw message for
  debugging, so never deploy without it.
- Without a configured `JWT_SECRET`, every Playground WebSocket authentication is refused rather than
  accepting unauthenticated sessions.
- On `SIGTERM`/`SIGINT`, the server stops accepting new connections, drains in-flight HTTP and
  WebSocket work, and force-exits if the drain does not complete within its timeout, so shutdown is
  bounded rather than indefinite.
- Machine-readable route contract: [`openapi.yaml`](../openapi.yaml).

## Non-goals

- Does not own provider semantics, session policy, or Playground UI state.

## Design decisions

- `createApp({ providers })` accepts providers directly rather than only deriving them from
  environment API keys, so behavior can be exercised and tested without live credentials while
  deployments that pass nothing are unaffected.
