---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
---

An external event is admitted only by a bearer access token the session verifies itself, and its sender is the
grant that token matched, never a name in the event.

- `agent-interface-transport` — `IExternalEventGrant` (a label, an access-token verifier configuration that pins
  exactly one subject or client, the `message` kind, optional turn-rate windows), `IExternalEventDelivery` (the
  token and the event as a carrier received them), the closed `TExternalEventRefusal` set, `TExternalEventAdmission`
  and the content-free `TExternalEventAuditRecord`.
- `agent-framework` (breaking) — `ExternalEventIngress.open` and `InteractiveSession.openExternalEventSource` take
  `{ grant, verifier, audit? }` instead of `{ id, allowedSenders, authenticate }`, and `receive` takes
  `{ token, event }`. A delivery is refused with a stable word when the token is missing or the verifier refuses
  it, when the token was already spent on an event (`jti`), when the event is malformed or oversize, or when the
  grant is over its rate; nothing refused reaches the queue. An admitted event is attributed
  `external:<grant>:<conversation>`, a payload display name appears in the envelope only as `claimed-name`, and the
  receipt (`TExternalEventReceipt`) answers at acceptance with the turn id. Every refusal and settlement is
  reported to the `audit` sink without content, conversation, name or token. `IAuthenticatedExternalEvent` and
  `IExternalEventReceipt` are removed.
- `agent-cli` (breaking) — `--external-event-allow` is refused with the reason: a sender name relayed by an MCP
  server does not prove who sent an event.
