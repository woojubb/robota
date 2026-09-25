# @robota-sdk/agent-mcp

## 3.0.0-beta.80

### Major Changes

- 796ddb4: Use a neutral default MCP client name and let hosts supply their own protocol identity. Robota CLI startup now explicitly supplies its prior `robota-agent-mcp` name, preserving its initialize handshake; embedders relying on that implicit name can set `clientInfo` explicitly.

### Minor Changes

- 3ac6c48: Remote MCP servers get a client authentication port. OAuth and a dynamic header helper will plug
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

- ff1f0ed: MCP definitions now record where each materialized value came from. One principle, read from
  that record, decides what is secret, and the fingerprint and every printed value use it.

  - **Provenance:** `materializeDefinition` records, for every expanded field, the stretches each
    variable produced, and whether that variable is credential-shaped (`provenance`).
    - A credential-shaped variable is matched by whole name segments, case-insensitively: `TOKEN`,
      `SECRET`, `PASSWORD`, `KEY`, `AUTH`, `PAT`, `COOKIE`, `DSN`, `DATABASE_URL`, and similar.
    - A value under a credential-shaped env or header key is secret as a whole.
  - **Fingerprint:** it now covers env and header **values** too, with each secret replaced by a
    marker naming its source.
    - A changed `NODE_OPTIONS` value, a changed host around a token, or a changed non-secret
      variable now invalidates an approval on every transport.
    - Rotating a credential still does not.
    - The fingerprint is versioned, so approvals recorded before this change are asked for again
      once. The default approval store is in memory.
  - **Printed values:**
    - The activation endpoint and a projected URL show their secret stretches as `secret:VAR`.
    - A refused redirect's error names origins only.
    - Stdio command, args and cwd projections stay redacted wholesale.
  - **New contracts:**
    - `IMCPValueSpan`, `TMCPValueProvenance`, and `IMCPServerDefinitionResolved.provenance`.
    - `isCredentialShapedName`, `withoutSecrets`, `secretMarker`, `SECRET_LITERAL`.
    - `activationEndpoint`.

- 0d369ce: Remote MCP servers can take their request headers from a header helper.

  - **Declaring one:** `"headersHelper": { "command": "/absolute/path", "args": [...] }` on a remote
    server definition.
    - `${}` templates are refused, as they are for stdio.
    - The shell-string form other clients accept is refused, with a message showing the argv form.
    - `headersHelper` is no longer reported as unsupported authentication; only `oauth` is.
  - **Allowing one:** a helper runs only when all of these hold:
    - its exact command and arguments are listed in `mcpHeaderHelpers` in the user's own settings.
      A project, local, managed or plugin source cannot add to that list.
    - the server's activation is approved. The helper is part of the definition fingerprint, and the
      activation endpoint shows it beside the URL, with arguments quoted and control characters
      escaped.
    - for a `project` or `local` definition, the workspace is trusted.

    Otherwise the server is refused with `headers-helper-not-allowed` or `headers-helper-untrusted`.
    It is never connected with its static headers alone.

  - **Running it** (`agent-cli`):
    - No shell. It runs in the project directory for a `project`/`local` definition, and in
      `~/.robota` otherwise.
    - Its environment is the host's without runtime-loading variables (`NODE_OPTIONS`, `LD_*`,
      `BASH_ENV`, …). A `project`/`local` helper also gets no credential-shaped variables.
      `ROBOTA_MCP_SERVER_NAME` and `ROBOTA_MCP_SERVER_URL` are set. For a `project`/`local` helper
      the URL keeps its `${VAR}` references instead of what the environment expanded them to.
    - Limits: 10 s and 64 KiB of stdout. Stderr is discarded. The process tree is killed on timeout
      or cancel.
  - **Its output** (`agent-mcp`, `parseHeadersHelperOutput`):
    - Exactly one JSON object of string values.
    - Refused: invalid or duplicate names (case-insensitive), more than 32 headers, and headers the
      transport owns (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Content-Type`,
      `Accept`, `Mcp-Session-Id`, `Mcp-Protocol-Version`, `traceparent`).
  - **When it runs:** once per connection, one run at a time, and once more after a 401/403.
    - Requests refused together cost one new run: the reusable `MCPSingleFlightCache` tags each value
      with a generation and drops it only when the refused request used the current one.
    - `IMCPAuthorizationRejection` now carries `authorization`, the object `authorize` returned for
      the refused request, so an authenticator can tell which credential was refused.
    - A reconnect runs the helper afresh. A helper still running when the CLI exits is killed.
    - Failures are `MCPHeadersHelperError` with a fixed reason. Nothing the helper printed reaches an
      error or a diagnostic.
  - `IMCPHttpEndpoint.authenticationRequired` refuses admission (`authentication-unavailable`) when no
    authenticator is registered.

- d4189b9: The rest of the per-server MCP OAuth lifecycle: signing in to a server without a local browser,
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
    server name is shown there only when it is safe to paste into any shell — a plain token not
    starting with `-` or `=` — and is otherwise replaced by `<server>` (`shellArgumentForDisplay` in
    `agent-core`; nothing is quoted, since quoting rules differ between shells). Server names in OAuth
    notices have control and format characters escaped.
  - **Refresh hardening:** on `invalid_grant`, the store is read again under the lock; a refresh token
    another holder rotated in meanwhile is kept (and used when still valid) instead of being deleted.
    The expiry skew is capped at half the token's lifetime, so a short-lived token is not refreshed on
    every request; credentials now record `issuedAt` for this.

- 9edae52: Remote MCP servers can authenticate with OAuth: `robota mcp login <name>` signs in, and sessions
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
      be the server it was fetched for, the server, authorization, token and registration
      endpoints must be `https`, and the authorization server must advertise PKCE `S256`
      (`pkce-unsupported` otherwise). A 401's `resource_metadata` is never followed to another origin,
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
    `~/.robota/mcp-credentials/`. The issuer, token endpoint and client (with its secret, if any, and
    the client authentication method dynamic registration returned) are stored with the tokens. A
    sign-in stores its credential under the refresh lock, so a refresh in flight cannot overwrite it.
  - **Sessions** (`createOAuthAuthenticator`, wired for every `oauth` definition):
    - Sends the stored token as `Authorization: Bearer`, refreshing it first when expired — including
      a token cached earlier in the session — and only at the stored token endpoint.
    - One refresh at a time per credential: in a process through `MCPSingleFlightCache`, across
      processes under `createFileOAuthRefreshLock`, re-reading the store once the lock is held. A
      stale lock is taken over, and a lock released, only after it is renamed aside and proven to be
      the one judged — never another process's fresh lock.
    - A 401 rediscovers, then refreshes once and retries; an authorization server that changed clears
      the tokens — compared, under the lock, with what is stored then, so a newer sign-in is kept. `invalid_grant`, or nothing stored, asks the user to run `robota mcp login <name>`. A 403
      `insufficient_scope` fails and names the scope.
    - An `oauth` definition is never connected without the authenticator (`oauth-unavailable`).
  - Failures are `MCPOAuthError` with a fixed reason; no code, verifier, token, secret or
    authorization-server text reaches an error, a notice or a log.

- aac2efd: MCP definition projections now show stdio command, args and cwd readable instead of `[REDACTED]`, with only their secret stretches masked: values expanded from credential-shaped variables (`secret:VAR`) and literals shaped like a credential (`secret:literal`) — the value after a credential-named flag, known token formats (`sk-`, `ghp_`, `github_pat_`, `glpat-`, `xoxb-`, `AKIA…`, `AIza…`, JWTs, `Bearer …`) and long high-entropy runs, while commit SHAs and sha256 digests stay visible. Credential-named header-form values (`X-API-Key: …`, any `Authorization` scheme), JSON or dict entries (`{"apiKey":"…"}`) and connection-string entries (`;Password=…`) are masked too. URLs additionally mask a userinfo password and credential-named query or fragment values. `activationEndpoint` applies the same masking. `env` and `headers` values stay fully redacted, and the definition fingerprint is unchanged — the shape detector is display-only.

  New exports: `looksLikeCredential`, `maskCredentials`, `displayValue`, `displayArgs`.

### Patch Changes

- 196a900: Permission rules can say more than one argument per tool.

  - **`Tool(name:value)` in deny and ask rules** matches a named top-level parameter, with `*` in the
    value (`Bash(run_in_background:true)`, `Agent(model:opus*)`, `github__create_issue(repo:acme/*)`).
    It is a parameter rule only when `name` is one of the tool's parameters, so
    `WebFetch(https://…)` keeps its meaning. A parameter the call omits never matches, and a
    non-scalar value is unevaluable, so the call asks. Allow rules may not use the form.
  - **A rule on the primary field** (`Bash(command:rm *)`) is reported at startup and asks on every
    call, instead of being silently ignored.
  - **Tool-name globs.** Deny and ask rules may glob the tool name (`github__*`). Allow rules may do so
    only after a literal `<server>__` prefix; an unanchored allow glob is refused at construction.
  - **A bare-name deny removes the tool from the model's context.** `Tool`, `Tool(*)` or a name glob
    withholds it from the offered set and the deferred-tool catalogue, live, instead of offering it
    and refusing every call. `IAgentConfig.isToolVisible` is the new seam.
  - **MCP canonical names keep the whole `<server>__` prefix when truncated**, so a server glob still
    names every tool of that server.

- dcf1d65: CORE-040: an MCP tool's declared parameters are enforced, not merely advertised

  `MCPTool.validateParameters` and `RelayMcpTool.validateParameters` each hand-rolled the same check —
  presence of the schema's TOP-LEVEL `required` keys, and nothing else. No types, no enums, no bounds,
  no nested traversal. `parameters` was a contract the model was shown and the runtime did not hold: a
  payload with the right key names and entirely wrong values reached the tool handler unchallenged.

  Both now route through one validator and through `validateAgainstJsonSchema`, the single complete
  walk over the universal subset.

  An MCP `inputSchema` is authored by a third-party server, so it may use ordinary JSON Schema this
  repo's subset cannot model — and the walk REJECTS such a node, which would refuse every payload for
  that tool. The schema is therefore narrowed rather than refused: inexpressible property subtrees are
  replaced with an accepts-anything node (replaced, not deleted — an object declaring `properties` is
  closed, so deleting a key would make the server's own parameter an "unexpected additional property"),
  `required` is untouched so presence is still enforced, everything expressible is enforced completely,
  and the unenforceable paths are reported once per tool rather than passed over in silence.

  - `IRelayMcpOptions.onUnenforceableSchema`, and a third `MCPTool` constructor argument, receive that
    report. Omitting them logs a warning.
  - `narrowToUniversalSubset`, `ThirdPartySchemaValidator`, `INarrowedSchema` and
    `TUnenforceableSchemaReporter` are exported: which parts of someone else's schema this runtime can
    enforce is a fact a consumer needs to be able to inspect.
  - The package now declares a `source` export condition, alone among its siblings in lacking one — a
    `--conditions=source` consumer silently got the built output instead.

- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [d6b9404]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73
- @robota-sdk/agent-tools@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.72
- @robota-sdk/agent-tools@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-tools@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.70
- @robota-sdk/agent-tools@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.69
- @robota-sdk/agent-tools@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68
- @robota-sdk/agent-tools@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.67
- @robota-sdk/agent-tools@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.66
- @robota-sdk/agent-tools@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65
- @robota-sdk/agent-tools@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.64
- @robota-sdk/agent-tools@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.63
- @robota-sdk/agent-tools@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62
  - @robota-sdk/agent-tools@3.0.0-beta.62

## 3.0.0-beta.61

### Patch Changes

- Updated dependencies [e243fb0]
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [18fcc5b]
- Updated dependencies [d97bdf2]
- Updated dependencies [3bde012]
  - @robota-sdk/agent-tools@3.0.0-beta.61
  - @robota-sdk/agent-core@3.0.0-beta.61

## 3.0.0-beta.60

### Patch Changes

- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60
  - @robota-sdk/agent-tools@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- Updated dependencies [95721ff]
  - @robota-sdk/agent-tools@3.0.0-beta.59
  - @robota-sdk/agent-core@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58
  - @robota-sdk/agent-tools@3.0.0-beta.58

## 3.0.0-beta.57

### Patch Changes

- Updated dependencies [16c3b6f]
- Updated dependencies [f61e2cb]
- Updated dependencies [822a78b]
  - @robota-sdk/agent-core@3.0.0-beta.57
  - @robota-sdk/agent-tools@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56
  - @robota-sdk/agent-tools@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55
  - @robota-sdk/agent-tools@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.54
  - @robota-sdk/agent-tools@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53
  - @robota-sdk/agent-tools@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.52
- @robota-sdk/agent-tools@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.51
- @robota-sdk/agent-tools@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.50
  - @robota-sdk/agent-core@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.49
  - @robota-sdk/agent-core@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.48
- @robota-sdk/agent-tools@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.47
- @robota-sdk/agent-tools@3.0.0-beta.47

## 3.0.0-beta.46

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.46
- @robota-sdk/agent-tools@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.45
- @robota-sdk/agent-tools@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.44
  - @robota-sdk/agent-tools@3.0.0-beta.44
