---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

The rest of the MCP OAuth lifecycle: signing in without a local browser, signing out with token
revocation, and sign-in state in `/mcp`.

- **`robota mcp login <name> --no-browser`** prints the authorization URL and reads the redirect URL
  the user pastes back (not echoed). `runMCPOAuthLogin` takes `readRedirect` for this; nothing
  listens on the redirect URI then. The pasted URL is held to the loopback listener's rules through
  `createPastedRedirectAcceptor`: it must be the registered redirect URI (same origin and path, no
  user info), carry the sign-in's `state` (compared in constant time), and is accepted once; an
  error redirect is `authorization-denied` without its `error_description`, and the RFC 9207 `iss`
  check applies as before. `openBrowser` now also receives the redirect URI.
- **Signing out** (`runMCPOAuthLogout`; `robota mcp logout <name>`; `/mcp logout <serverId>`):
  deletes the stored credential under the refresh lock, then revokes the refresh token and the
  access token (RFC 7009) when the stored issuer advertises `revocation_endpoint`. Revocation is a
  POST through the egress policy that never follows a redirect, is byte-bounded, and authenticates
  the client the way its refresh does. The local delete always happens; the outcome is `revoked`,
  `unsupported`, `failed` (with a fixed reason, new `revocation-failed` among them) or
  `not-attempted`. `/mcp logout` also makes the session's authenticator drop the token it holds
  (`IMCPOAuthAuthenticator.forget`).
- **Sign-in state:** `readMCPOAuthCredentialState` answers `signed-in`, `expired-refreshable`,
  `sign-in-required` or `signed-out` — never anything token-derived. `/mcp` shows it for every
  OAuth server; a server this session was told needs a sign-in reads `sign-in-required`.
  `ICommandMCPActivationAdapter` gains optional `oauthStatus` and `oauthLogout`
  (`ICommandMCPOAuthStatus`, `ICommandMCPOAuthLogoutResult`).
- **`/mcp login <serverId>`** prints the `robota mcp login` command instead of running the flow: a
  sign-in needs the terminal (browser, pasted redirect, hidden secret prompt) that the running
  session owns, and a server refused at startup is connected by the next session anyway.
- **Refresh hardening:** on `invalid_grant`, the store is read again under the lock; a refresh token
  another holder rotated in meanwhile is kept (and used when still valid) instead of being deleted.
  The expiry skew is capped at half the token's lifetime, so a short-lived token is not refreshed on
  every request; credentials now record `issuedAt` for this.
