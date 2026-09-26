---
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-mcp': minor
'@robota-sdk/agent-cli': minor
---

External events arrive over HTTP: `POST <public-url>/events/<grant-id>`, on a loopback port behind the owner's own
HTTPS proxy or tunnel.

- `agent-transport` — `./node` exports the resource-server gate every token-admitted HTTP carrier shares:
  `createBearerResourceServer` (Host and Origin checked against the public URL, trusted-proxy `X-Forwarded-For`,
  a failure-only throttle per address, coarse address classes), `describeProtectedResource` (RFC 9728 metadata
  path and body, RFC 6750 challenges), `serveProtectedResourceMetadata`, `refuseBearerToken` and
  `parsePublicHttpsUrl`.
- `agent-transport-mcp` — the remote MCP gate is composed from that shared gate; its answers are unchanged.
- `agent-cli` — each grant is its own endpoint and audience (its resource is `<public-url>/events/<grant-id>`).
  An admitted event answers `202 {"turnId"}`; refusals have an empty body: 401 with the `invalid_token` or
  missing-token challenge, 403 `insufficient_scope` or a revoked grant, 400 a malformed event, 404 an unknown
  grant, 413 a body over 16 KiB, 429 over the grant's rate or the address's failure budget, 503 when the issuer
  or the session cannot take it. `--external-event-port <port>` (required with grants) and
  `--external-event-trusted-proxy <ip>` work on the TUI and on `robota session start --background`. A background
  session writes an owner-only, bounded JSONL trail of refusals and settlements under its supervised directory;
  the TUI reports them on one line each.
