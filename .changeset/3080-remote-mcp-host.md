---
'@robota-sdk/agent-transport-mcp': minor
'@robota-sdk/agent-cli': minor
---

`robota mcp serve` can serve a remote MCP client as an OAuth resource server.

`agent-transport-mcp` gains `createMcpRemoteHttpHost`, which admits requests only by an OAuth access
token checked by an injected `IAccessTokenVerifier`. Its endpoint path and its RFC 9728
protected-resource metadata path are derived from the `https` public URL, so a proxy prefix works,
and Host and Origin are checked against that public origin. A refusal has an empty body: `401` with
`WWW-Authenticate: Bearer resource_metadata="…"` (plus `error="invalid_token"` when a token was
presented), or `403` with `error="insufficient_scope"`. The token is verified before anything is
counted, and only failures are counted, per client address, so a valid token is never throttled;
`X-Forwarded-For` is believed only from a configured trusted proxy. Each refusal goes to an injected
audit sink as a reason and an address class, never token text. The host stays stateless and issues
no `Mcp-Session-Id`. The loopback `createMcpHttpHost` is unchanged.

`agent-cli` adds `--http-public-url`, `--http-host`, `--oauth-issuer`, `--oauth-scopes`,
`--oauth-allowed-subjects` and `--trusted-proxy` to `robota mcp serve`. It binds an address other than
`127.0.0.1` only with the public URL and the OAuth settings, and never with `--http-token-file`.
Refusals are logged on stderr without token text.
