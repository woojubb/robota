---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': minor
---

Remote MCP servers get a client authentication port. OAuth and a dynamic header helper will plug
into it without the transport changing.

- **`IMCPClientAuthenticator`:**
  - A host registers one for one server identity: `authenticatorFor` on the CLI's MCP client
    composition, or `authentication` on `IMCPHttpEndpoint`.
  - The Streamable HTTP transport asks it for headers on every request to that server, after
    admission. Its headers override a static header of the same name.
- **Failures:**
  - A 401/403 is retried at most once, with fresh authorization, when the authenticator answers
    `retry`.
  - Otherwise the connection is refused with `MCPAuthenticationError`, which is classified as
    `auth`. Neither the credential nor the authenticator's text appears in it.
  - There is never an unauthenticated attempt.
- **`oauth` and `headersHelper` in a definition** were silently ignored.
  - On a remote server they are now decoded as `unsupportedAuthentication`: the server stays
    listed, and admission refuses it by name (`unsupported-authentication`) instead of connecting
    without the credential.
  - On a stdio server they are a definition problem.
