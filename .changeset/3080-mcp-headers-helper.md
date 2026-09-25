---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': minor
---

Remote MCP servers can take their request headers from a header helper.

- **Declaring one:** `"headersHelper": { "command": "/absolute/path", "args": [...] }` on a remote
  server definition.
  - `${}` templates are refused, as they are for stdio.
  - The shell-string form other clients accept is refused, with a message showing the argv form.
  - `headersHelper` is no longer reported as unsupported authentication; only `oauth` is.
- **Allowing one:** a helper runs only when all of these hold:
  - its exact command and arguments are listed in `mcpHeaderHelpers` in the user's own settings.
    A project, local, managed or plugin source cannot add to that list.
  - the server's activation is approved. The helper is part of the definition fingerprint, and the
    activation endpoint shows it beside the URL.
  - for a `project` or `local` definition, the workspace is trusted.

  Otherwise the server is refused with `headers-helper-not-allowed` or `headers-helper-untrusted`.
  It is never connected with its static headers alone.

- **Running it** (`agent-cli`):
  - No shell. It runs in the project directory for a `project`/`local` definition, and in
    `~/.robota` otherwise.
  - Its environment is the host's without runtime-loading variables (`NODE_OPTIONS`, `LD_*`,
    `BASH_ENV`, …). A `project`/`local` helper also gets no credential-shaped variables.
    `ROBOTA_MCP_SERVER_NAME` and `ROBOTA_MCP_SERVER_URL` are set.
  - Limits: 10 s and 64 KiB of stdout. Stderr is discarded. The process tree is killed on timeout
    or cancel.
- **Its output** (`agent-mcp`, `parseHeadersHelperOutput`):
  - Exactly one JSON object of string values.
  - Refused: invalid or duplicate names (case-insensitive), more than 32 headers, and headers the
    transport owns (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Content-Type`,
    `Accept`, `Mcp-Session-Id`, `Mcp-Protocol-Version`, `traceparent`).
- **When it runs:** once per connection, one run at a time, and once more after a 401/403.
  - The reusable `MCPSingleFlightCache` provides this.
  - Failures are `MCPHeadersHelperError` with a fixed reason. Nothing the helper printed reaches an
    error or a diagnostic.
- `IMCPHttpEndpoint.authenticationRequired` refuses admission (`authentication-unavailable`) when no
  authenticator is registered.
