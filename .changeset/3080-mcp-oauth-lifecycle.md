---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

The rest of the per-server MCP OAuth lifecycle: signing in to a server without a local browser,
signing out of it with token revocation, and each server's sign-in state in `/mcp`.

- **`robota mcp login <name> --no-browser`** prints the authorization URL and reads the redirect URL
  the user pastes back (not echoed). `runMCPOAuthLogin` takes `readRedirect` for this; nothing
  listens on the redirect URI then. The pasted URL is held to the loopback listener's rules through
  `createPastedRedirectAcceptor`: it must be the registered redirect URI (same origin and path, no
  user info), carry the sign-in's `state` (compared in constant time), and is accepted once; an
  error redirect is `authorization-denied` without its `error_description`, and the RFC 9207 `iss`
  check applies as before. `openBrowser` now also receives the redirect URI. `readRedirect` gets a
  signal that aborts on cancel or at `callbackTimeoutMs` (5 minutes by default, as for the loopback
  listener); a paste longer than the prompt accepts fails as `redirect-too-long`.
- **Signing out** (`runMCPOAuthLogout`; `robota mcp logout <name>`; `/mcp logout <serverId>`):
  deletes the stored credential under the refresh lock, then revokes the refresh token and the
  access token (RFC 7009) when the stored issuer advertises `revocation_endpoint`. Revocation is a
  POST through the egress policy that never follows a redirect and is byte-bounded; it authenticates
  the client by `revocation_endpoint_auth_methods_supported` when advertised, otherwise the way its
  refresh does. The local delete always happens. Each token's outcome is reported in `tokens`, and
  overall as `revoked`, `partial`, `unsupported`, `failed` or `not-attempted`, with fixed reasons
  only (new: `revocation-failed`, and `token-type-not-revocable` for RFC 7009
  `unsupported_token_type`). `/mcp logout` also makes the session's authenticator drop the token it
  holds (`IMCPOAuthAuthenticator.forget`).
- **Sign-in state:** `readMCPOAuthCredentialState` answers `signed-in`, `expired-refreshable`,
  `sign-in-required` or `signed-out` — never anything token-derived. `/mcp` shows it for every
  OAuth server; a server this session was told needs a sign-in reads `sign-in-required`.
  `ICommandMCPActivationAdapter` gains optional `oauthStatus` and `oauthLogout`
  (`ICommandMCPOAuthStatus`, `ICommandMCPOAuthLogoutResult`).
- **No in-session sign-in:** signing in stays `robota mcp login <server>` in a terminal, since it
  needs the terminal (browser, pasted redirect, hidden secret prompt) a running session owns. `/mcp`
  names that command for a server that needs a sign-in, as does the session's sign-in notice; the
  server name is shown unquoted only as a plain shell token, single-quoted otherwise, and left out
  when it holds a control or format character (`shellArgumentForDisplay` in `agent-core`).
- **Refresh hardening:** on `invalid_grant`, the store is read again under the lock; a refresh token
  another holder rotated in meanwhile is kept (and used when still valid) instead of being deleted.
  The expiry skew is capped at half the token's lifetime, so a short-lived token is not refreshed on
  every request; credentials now record `issuedAt` for this.
