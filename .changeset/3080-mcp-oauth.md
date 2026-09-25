---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': minor
---

Remote MCP servers can authenticate with OAuth: `robota mcp login <name>` signs in, and sessions
send the stored token.

- **Declaring it:** `"oauth": { "clientId"?, "callbackPort"?, "authServerMetadataUrl"?, "scopes"? }`
  on a remote server definition, decoded into `IMCPOAuthConfig`.
  - `authServerMetadataUrl` must be `https`. `scopes` wins over the server's metadata and a 401's
    `scope`.
  - A `clientId` needs a `callbackPort`: a pre-registered client's redirect URI is fixed.
  - `clientSecret`, unknown keys and `${}` templates are refused; `oauth` beside `headersHelper`,
    or on a stdio server, is refused.
  - `oauth` is no longer reported as unsupported authentication, and it is part of the definition
    fingerprint.
- **Signing in** (`runMCPOAuthLogin`; `robota mcp login <name> [--client-secret]`):
  - Discovery is done here, not by the SDK's `discoverOAuthServerInfo`: the protected-resource
    metadata `resource` must be the canonical server URL, the authorization server's `issuer` must
    be the server it was fetched for, and the server, authorization, token and registration
    endpoints must be `https`. A 401's `resource_metadata` is never followed to another origin,
    and a server without resource metadata is not guessed at.
    `authServerMetadataUrl` skips resource discovery.
  - Dynamic client registration when there is no `clientId`; PKCE, a random `state` and the
    RFC 8707 resource indicator on the authorization request; the RFC 9207 `iss` checked on the
    redirect when sent, and required when the server promises it.
  - The loopback callback listens on `127.0.0.1`, checks `Host`, answers only `GET /callback` with
    the sign-in's `state` (compared in constant time), once, within 5 minutes, and serves a static
    page that never shows `error_description`.
  - The browser opens by argv (`open`, `xdg-open`, `rundll32 url.dll,FileProtocolHandler`) and only
    for an `https` URL. `--client-secret` asks for the secret without echo (or reads stdin's first
    line) and only for a pre-registered client.
- **Network:** every OAuth request goes through the egress policy and is capped at 256 KiB.
  `agent-core` adds `postWithEgressPolicy`, which refuses a redirect (`redirect_refused`) instead
  of following it; registration, token and refresh requests use it.
- **Storage:** `IMCPOAuthCredentialStore` (`get`/`set`/`delete`), keyed by the server's security
  identity and canonical URL together. `createFileOAuthCredentialStore` keeps 0600 files in a 0700
  `~/.robota/mcp-credentials/`. The issuer, token endpoint and client (with its secret, if any) are
  stored with the tokens.
- **Sessions** (`createOAuthAuthenticator`, wired for every `oauth` definition):
  - Sends the stored token as `Authorization: Bearer`, refreshing it first when expired — only at
    the stored token endpoint.
  - One refresh at a time per credential: in a process through `MCPSingleFlightCache`, across
    processes under `createFileOAuthRefreshLock`, re-reading the store once the lock is held.
  - A 401 rediscovers, then refreshes once and retries; an authorization server that changed clears
    the tokens. `invalid_grant`, or nothing stored, asks the user to run `/mcp login <name>`. A 403
    `insufficient_scope` fails and names the scope.
  - An `oauth` definition is never connected without the authenticator (`oauth-unavailable`).
- Failures are `MCPOAuthError` with a fixed reason; no code, verifier, token, secret or
  authorization-server text reaches an error, a notice or a log.
