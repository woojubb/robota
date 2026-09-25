---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Sign in to a remote MCP server from inside a session, and use its tools without restarting.

- **`/mcp login <server> [--no-browser]`** runs the same per-server OAuth sign-in as
  `robota mcp login` (discovery checks, PKCE, `state`, RFC 9207 `iss`, RFC 8707 resource, the
  loopback listener, the lock-guarded store). It opens the browser through the argv opener; with
  `--no-browser`, or when no browser can be opened, it shows the authorization URL and asks for the
  redirect URL in the session's own prompt (masked), held to the same rules as a pasted redirect in
  the terminal. A failed, refused, timed-out or cancelled sign-in changes nothing and is reported by
  a fixed reason only. `/mcp login <server> --client-secret` is refused: a secret is never typed into
  a session, and `robota mcp login <server> --client-secret` is named instead (also after a failed
  token exchange for a pre-registered client). `/mcp` stays user-only (`modelInvocable: false`).
- **Connected in the same session:** after a sign-in, a server that could not connect for want of
  one goes through the normal admission (approval, fingerprint, trust) and connects, and its tools
  are offered from the next message; a server whose tools were already offered reconnects, and its
  authenticator drops what it held and reads the new credential.
- **`runMCPOAuthLogin`** takes `readRedirectWhenBrowserFails`: when `openBrowser` rejects, the
  loopback listener stops and the pasted redirect is read instead, for the same redirect URI.
- **`Session.addTools`** (and `ICommandSessionTools.addTools`) offers tools that became usable
  mid-session, through the same permission gate and — via `ISessionOptions.wrapAddedTools`, which
  `createSession` sets — the same edit-checkpoint and reversible-execution wraps as the assembled
  tools. A name the session already has is left out, never replaced.
- **`ICommandMCPActivationAdapter.oauthLogin`** (`ICommandMCPOAuthLoginRequest`,
  `ICommandMCPOAuthLoginResult`, `ICommandMCPOAuthRedirectPrompt`) is the port behind it.
- The sign-in notice and `/mcp status` now suggest `/mcp login <server>` in a session and
  `robota mcp login <server>` in a terminal; the server's name is shown only when it is safe to paste
  into any shell, otherwise `<server>`.
