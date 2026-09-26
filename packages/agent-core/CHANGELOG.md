# @robota-sdk/agent-core

## 3.0.0-beta.82

### Minor Changes

- c7f9203: Connected sessions can send each other files.

  - `/peers send-file <session-id> <path>` sends a copy of any file the operator can read to another
    live session on this host.
  - The model sends a file only through the `peer_send_file` tool. Every call asks the user, showing
    the path, size, hash and destination; no permission mode, rule or remembered consent answers it.
    The tool reaches only files inside the workspace whose path does not look like it holds secrets
    (`.env*`, `~/.ssh`, keys and credentials), and it does not exist in a turn a peer's message started.
  - The receiving operator approves every file. A received file is kept as an inert copy (mode 0600)
    under `~/.robota/peer-files/<sender>/`. It is never run and never placed in the model's context.
    The conversation is told only its name, size and sha256. A name that leaves that directory is
    refused, a symbolic link is never written through, and nothing is overwritten.
  - Transfers travel on a channel of their own (a separate connection on this host, a separate data
    channel between devices), in chunks the receiver paces, up to 32 MiB, and are kept only when the
    whole content matches the offered sha256. A transfer that ends early is discarded; there is no
    resume.

  **API**

  - `agent-interface-session-mobility`: the `file` capability, which asks the operator for every
    request; `ConnectionAuthority.authorizeFile`; `IFileOffer` and `IFileFrameChannel`.
  - `agent-transport/node`: `sendFileOverChannel` and `receiveFileOverChannel`, the carrier over any
    `IFileFrameChannel`; `DEFAULT_MAX_FILE_BYTES`.
  - `agent-transport-webrtc`: `IDeviceMeshLink.openFileChannel` and `onFileChannel`.
  - `agent-remote-pairing`: `file` joins `DEVICE_CAPABILITIES`. A device certificate that names it is
    refused as malformed by an earlier version.
  - `agent-core`: `IToolPermissionProfile.notInPeerTurn` withholds a tool from a turn a peer's message
    started.
  - `agent-framework`: `ICommandLocalPeersAdapter.prepareFile`.

## 3.0.0-beta.81

### Minor Changes

- 3038eb7: A message from another session is instant messaging: text from an untrusted third party that
  carries no authority. What the model does with it is decided by the session's ordinary permissions —
  rules, permission mode and remembered consent — exactly like the session's own work. The per-origin
  peer policy is gone.

  **BREAKING**

  - `agent-core`: `IPermissionEvaluationContext.peerTurn` is now a boolean. It decides only whether a
    `repliesToPeer` tool exists; every other call in a peer turn is decided as in any turn. Removed:
    `isToolAvailableInPeerTurn`, `isSecretPath`, `IPeerTurnAuthority`, `TPeerReach` (now exported by
    `agent-interface-session-mobility`) and `IToolPermissionProfile.workspacePaths`.
  - `agent-tools`: `Read` and `Glob` no longer declare `workspacePaths`.
  - `agent-session`: `ISessionRunOptions.peerReach` is replaced by `peerTurn?: boolean`, and
    `ISessionOptions.allowPeerChanges` is removed. An ask in a peer turn is answered like any other:
    a consent the operator remembered answers it, and an "always allow" given there is remembered.
  - `agent-interface-session`: `IPeerTurnContext` no longer has `reach`; it carries only the reply
    route.
  - `agent-interface-session-mobility`: `peerReachOf` is removed; `TPeerReach` moves here. A delegated
    turn carries no reach.
  - `agent-framework`: the `peers.allowChanges` setting is removed (an existing value is ignored). A
    peer turn is offered the ordinary tools, plus `peer_reply`.

  **Changes**

  - `agent-framework`: the per-turn statement tells the model the message is an opinion from an
    untrusted third party, not its owner's instruction, and that it decides for itself whether and how
    to act. A message still expands no `@path` and attaches no context reference, and its requests
    still carry no provider-hosted tool, since no permission step can decide one. The session takes
    at most 6 messages a minute and 30 an hour from each sender for a turn; a message over the limit
    is refused with a reason the sender receives. A prompt answer given in the name of a `peer:` or `external:`
    driver is ignored. External-event turns keep their tool-less baseline.
  - `agent-cli`: incoming peer turns carry only their reply route.

- 02b7452: A reply to a peer session is decided by the permission system like any call that sends something
  off this machine, and it goes only to the sender that was admitted.

  - `agent-core` — a tool declaring `repliesToPeer` is still refused outside a peer turn; inside one it
    is decided by the ordinary steps: deny, ask and allow rules, then the mode. It declares no risk
    class, so it asks by default, is refused in plan mode and proceeds under bypass. `IPeerTurnAuthority`
    no longer has `toolUsed`.
  - `agent-session` — an "always allow" answer to the reply is remembered and answers later replies,
    as for any tool; other asks in a peer turn still need a fresh approval each time.
  - `agent-framework` — `peer_reply` asks the operator by default, showing the full text and the peer
    it goes to; `permissions.allow`/`deny` rules naming `peer_reply` apply. `PeerMessageIngress`
    refuses a message whose origin names a sender other than the admitted one, or whose admission names
    no sender, and submits the turn with the admitted identity.
  - `agent-cli` — a local peer message is taken as coming from the session it names only when that
    session confirms, at its own socket, that it is sending exactly that message to this receiver.
    The reply target, the driver id and the operator's notices come from the confirmed sender. A
    session on an earlier version cannot confirm, so its messages are refused; both sessions need this
    version to message each other.

- ec5e477: Add a credential store port (`ICredentialStore` in `agent-core`) and keep the CLI's secrets behind it: the OS keychain through the optional `@napi-rs/keyring` binding (macOS Keychain, Windows Credential Manager, Linux Secret Service), else an owner-only file under `~/.robota/credentials`. The backend is chosen at first use, recorded, and named by `/remote-control status`; a recorded keychain that stops working fails closed instead of degrading to the file.

  The remote-control host identity key moves into the store. The old `~/.robota/remote-host-identity.json` may have been copied by backups or dotfile sync, so it is not carried over: on the first run after upgrading a new host key is generated, the old file is removed, and the operator is told once that trusted devices must pair again.

## 3.0.0-beta.80

### Major Changes

- 4eea54b: **`@robota-sdk/agent-core` removes `IMCPToolConfig` and `IToolFactory.createMCPTool()` with no compatibility facade.**

  Both were exported with no producer and no consumer. `IToolFactory` had no implementation anywhere in
  this repository — `grep -rn 'IToolFactory' packages/*/src apps/*/src` returned only the declaration
  and its export line — and nothing constructed an `IMCPToolConfig`. An MCP server definition is now
  owned by `@robota-sdk/agent-mcp` (MCP-001), which also absorbs the raw/validated/resolved
  forms, source provenance and shadow metadata, strict foreign `mcpServers` decoding, environment
  templates, whole-entry precedence, reversible disable overlays, redacted management projections and
  activation identity.

  `major` because an exported type and an interface member are gone. An external implementer of
  `IToolFactory` — there is none in this repository — stops compiling until it removes its
  `createMCPTool` member; a caller of the removed type must take the `agent-mcp` definition contract
  instead. No facade is retained deliberately: keeping a deprecated alias would re-create the state
  this change exists to end, two MCP contracts with one of them dead.

  `@robota-sdk/agent-mcp` is the same workspace package previously named `@robota-sdk/agent-tool-mcp`,
  renamed in place. It stays `private`, so the rename publishes nothing; MCP-002 owns its publication
  together with the official MCP TypeScript SDK client and the first product-reachable slice.

- f336838: One permission evaluation order for every caller. The interactive session, background tasks and
  subagents used to run two different resolvers, so the same call could be decided differently
  depending on who made it. They now share `evaluatePermission`, and a background policy only adds a
  ceiling, an ask-everything flag and the task's own lists to it:

  deny → caller ceiling → unevaluable deny (ask) → never-auto-approve set (ask) → ask-everything →
  bypassPermissions → allow → mode.

  - **`ask` rules.** `permissions.ask` patterns always ask, in every mode including
    `bypassPermissions`. They are matched per command like a deny rule, and are validated at
    construction alongside `allow` and `deny`.
  - **Never auto-approved, bypass included:** removing a critical path with `rm`/`rmdir` (the root, a
    top-level directory, home, the working directory or a parent), and a modify-class write into
    `.git`, `.robota`, `.claude`, `.agents`, `.mcp.json`, `.gitconfig`, `.npmrc` or a shell rc file.
    Files inside an isolated worktree (`.robota/worktrees/<name>/…`) are ordinary files. With no
    approver attached, an ask is a denial.
  - **A ceiling is checked before bypass and before any ask.** A subagent's `inherit-allowlist` ceiling
    is now the parent's _effective_ rules, read live at spawn: settings, preset lists and command
    auto-allows. It used to be the raw settings file. An unevaluable deny under a policy now asks,
    like everywhere else, where it used to deny outright; with no approver it is still a denial.
  - **Settings layers union `permissions.allow`**, as they already did `deny`. A checked-in project
    file no longer silently discards the user's allow list.
  - **Print mode, `createQuery()` and headless sessions default to `default` mode**, not
    `bypassPermissions`. They have no approver, so a call that would ask is denied. Pass
    `--permission-mode` / `permissionMode: 'bypassPermissions'` explicitly for unattended runs.

  **Breaking:**
  - `@robota-sdk/agent-core` removes `resolvePermissionByPolicy` and `TPermissionPolicyDecision` in
    favour of `projectPermissionPolicy` plus `evaluatePermission`'s new `context` argument.
  - `@robota-sdk/agent-framework` changes the settings merge rule for `permissions.allow`, and the
    default permission mode of `createQuery()` and headless sessions.

- 475e085: **BREAKING — CORE-028: the Node-only surface moves from the main barrel to `@robota-sdk/agent-core/node`.**

  `canonicalizePath`, `isPathInside`, `CommandExecutor` and `HttpExecutor` were exported from the main
  barrel. Each one needs `node:fs`, `node:path` or `node:child_process`, so the package's `browser`
  build had those three builtins in its static import graph — a package declaring a `browser` export
  condition while statically importing Node builtins. A bundler resolves that one of two ways: it
  errors, or it aliases the builtin to an empty object and the code fails later at a call site with no
  useful trace. Neither is a build you want to ship.

  The four now live at the `./node` subpath, which makes the dependency legible at the import site
  instead of hiding it inside a barrel. The main barrel's static graph imports zero Node builtins,
  which a test now holds at zero rather than at a list of known remainders.

  **Migration** — change the import path; no signature changed:

  ```ts
  // before
  import {
    canonicalizePath,
    isPathInside,
    CommandExecutor,
    HttpExecutor,
  } from '@robota-sdk/agent-core';

  // after
  import {
    canonicalizePath,
    isPathInside,
    CommandExecutor,
    HttpExecutor,
  } from '@robota-sdk/agent-core/node';
  ```

  `./node` carries `"browser": null`, declaring that the subpath has no browser implementation, so a
  resolver that honours a null target refuses it by name instead of quietly serving the Node build.

  That declaration is worth stating precisely, because it was measured rather than assumed. Bundling
  `import '@robota-sdk/agent-core/node'` under `['browser', 'import', 'default']` with the repo's own
  bundler does NOT stop at the null: through a workspace link it resolves the `source` entry and then
  fails on `node:fs`, `node:path` and `node:child_process`. The build still breaks, and the message
  still names the Node dependency, so the failure is visible either way — but by a different mechanism
  than the null, and only spec-compliant resolvers give the cleaner error. The claim here is the
  declaration, not a guarantee about every bundler.

### Minor Changes

- 1698be4: A child-process subagent can no longer send the parent's provider credential to a different
  endpoint.

  - **Before spawning a child**, the parent compares every environment variable that decides where
    the provider connects or which credential it sends. If the child's environment differs, the job
    is refused before the credential leaves the parent. The error names the variable, never its
    value. The variables compared are:
    - the proxy and TLS variables;
    - the variables the provider's SDK reads, such as `OPENAI_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and
      the Vertex settings;
    - the credential's own variable.
  - **The child** repeats the check before it builds its provider. It builds that provider from the
    parent's effective connection exactly: it no longer fills in a base URL, options or a default
    credential from its own registry, and a credential reference that resolves to nothing is refused.
  - **Where the effective connection comes from:** the parent applies its own definition defaults
    (base URL, options). `profileName` is sent only when it names the connection actually sent.
  - **New contracts:**
    - `IProviderDefinition.destinationEnvironment`, declared by every built-in provider.
    - `createProviderFromExactProfile`, `connectionEnvironmentNames`,
      `findConnectionEnvironmentDivergence`, `sealConnectionEnvironment`,
      `verifyConnectionEnvironment` and `TRANSPORT_ENVIRONMENT`.
    - The start payload's `connectionCheck`.
    - The child-process runner's `providerDefinitions` option, now required: a provider with no
      definition there is refused, because its connection cannot be checked.

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

- 4078a72: Model fallback chain. `--fallback-model a,b` (or the `fallbackModel` settings array; the flag wins) names up to three models a turn moves to when its model is overloaded, unavailable or failing on the server. An entry is a provider profile, `profile:model`, a bare model on the primary's provider, or `default`. The move happens only before any output has streamed, lasts for the current turn, and is shown as a system note; entries that cannot be built are passed over and entries outside the organization's `allowedProviders` are dropped with a notice. `FallbackProvider` in agent-framework implements it over the session's provider; `IChatOptions` gains `executionId`, `onModelFallback` and `preserveContextWindow`, `IAIProvider` gains optional `resolveModelRoute`, and the execution loop emits a `provider_fallback` event and attributes requests, call observations, committed replies, the response cache and usage to the model that answered. A turn that ran on more than one model records per-model `modelShares` on its usage observation, which personal usage reports split by model and provider. A `/provider` switch keeps the chain, read again for the new primary.
- 4c73a0b: Provider failures keep the vendor's HTTP status and error type. `ProviderError` gains `status` and `type`, adapters throw `ProviderError` (or `RateLimitError` for a rate limit) instead of a bare `Error`, an Anthropic mid-stream `overloaded_error` event surfaces as a `ProviderError` with that type, and media errors carry `status`. New `classifyProviderFailure` says whether a failure is worth retrying on another model, and `toProviderError` is the shared adapter mapping.
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

- 34e50f0: A new permission mode, `auto`, lets a model classifier approve or block what would otherwise prompt.

  - **What it decides:**
    - Reads and in-workspace edits run as in `acceptEdits`.
    - Commands and other calls the mode leaves open go to the classifier, a side call to the
      session's own model. It sees the call, the working directory and the git remotes, never the
      conversation.
    - A block reaches the model with its reason, so it can take another route.
  - **What still reaches a person, or is refused:**
    - Deny rules and background ceilings apply first.
    - `ask` rules, critical removals and protected paths ask a person.
    - After 3 refusals in a row (blocks, or no usable verdict), or 20 blocks in the session, the
      mode asks a person until one approves.
      With no one to ask, the call is denied.
  - **Allow rules:** in `auto` mode, allow rules that approve any command are set aside while the
    mode is on. Examples are `Bash(*)`, an interpreter (`Bash(python *)`), a package runner
    (`Bash(npm run *)`, `Bash(pnpm exec *)`), `Agent`, `ExecuteCommand` or `Computer`. Narrow
    rules still apply.
  - **Retry:** `/permissions` lists classifier blocks. `/permissions retry <n>` lets that exact call
    run once, unjudged, when the model tries it again.
  - **Turning it on and off:**
    - `--permission-mode auto`, `/mode auto` or `/permissions auto`.
    - An organization turns it off with `disableAutoMode` in the org policy.
  - **New contracts:**
    - `TPermissionMode` gains `'auto'`.
    - `allowRulesForAutoMode` and `isBroadExecutionAllowRule`.
    - `IPermissionClassifier` and `AutoModeGate`.
    - The `permissionClassifier` session option.
    - `Session.retryPermissionDenial`, and `retryDenial` on the permission-mode adapter.
    - The `'classifier'` denial reason.
    - `createModelPermissionClassifier`.
    - The `disableAutoMode` option on `createSession` and `IOrgPolicy`.

- 722e88a: Shell commands can run in an OS-level sandbox: bubblewrap on Linux and WSL2, Seatbelt on macOS.

  - **Confinement:** covers the command and every process it starts.
    - Writes are limited to the working directory, the temporary directories and
      `sandbox.filesystem.allowWrite`.
    - Agent, git-hook, MCP and shell configuration inside the workspace stays read-only.
    - `sandbox.filesystem.denyRead` hides paths from the command.
    - The network is on or off (`sandbox.network.enabled`).
  - **Modes:** `/sandbox` switches between `auto-allow`, `regular` and `off` for the next command and
    saves the choice.
    - In `auto-allow` (`sandbox.autoAllowBashIfSandboxed`), a confined command runs without a prompt
      in `default` and `acceptEdits`.
    - Deny rules, ask rules, critical removals and plan mode still apply first.
  - **Exclusions:** `sandbox.excludedCommands` run unconfined, through the ordinary permission path.
  - **When the sandbox cannot run:** a missing or unusable backend is reported at startup, in
    `robota doctor` and in `/sandbox`, and commands then run unconfined.
    `sandbox.failIfUnavailable` refuses to start instead.
  - **New contracts:**
    - `OsSandboxClient`, `detectOsSandbox`, `bubblewrapArguments`, `seatbeltProfile`.
    - `ISandboxClient.wrapCommand` and `autoApproves`.
    - `IPermissionEvaluationContext.sandboxAutoApproved`.
    - The `commandSandbox` session option.
    - The `sandbox` settings key and the `sandbox` command host adapter.

- d23c848: Built-in read-only shell commands run without a prompt.

  A Bash call is decided like a read, and runs without a prompt in every mode (`plan` included), when
  every command in it comes from the fixed read-only set (`ls`, `cat`, `grep`, `find` without actions,
  `git status`/`log`/`diff`/`show` and similar) and it also:

  - stays inside the workspace: every path operand resolves inside once symlinks are followed, as
    `Read` requires;
  - uses only printable ASCII syntax that bash, zsh, fish and PowerShell all read the same way.

  Deny and ask rules still apply first. A command that writes through a redirect, expands or
  substitutes anything, or runs git outside the session's repository takes the ordinary path.

  New exports: `isReadOnlyCommandLine` and `TResolveInWorkspace`. `IPermissionEvaluationContext`
  gains `resolveInWorkspace`, which `PermissionEnforcer` supplies.

- fec722f: Carry a trusted canonical absolute execution root from DAG product composition through worker task
  input and node lifecycle context. Filesystem-capable DAG nodes now use that injected authority instead
  of ambient `process.cwd()`, and authored `cwd` values may only narrow it.

  BREAKING: `ITaskExecutionInput`, `INodeExecutionContext`, worker composition dependencies,
  `LocalDagRuntimeProvider`, and the CLI-local runner now require an execution root at their non-convenience
  boundaries. `createDagFramework()` preserves no-argument construction by validating and capturing its
  current directory at the factory boundary. The filesystem-backed skill node is explicitly Node-only and
  no longer advertises a browser export condition.

- 2d3b2c0: Make shell resolution executable-aware across managed and scheduled background command runners. The core
  resolver now accepts one request with explicit-executable precedence, returns matching argument families
  for sh/bash, PowerShell/pwsh, and cmd, and fails closed with `UnsupportedShellError` for unknown explicit
  executables. Executor exposes one shared request adapter and both concrete runners consume its pair.
- 4772067: **BREAKING — ARCH-031: the subagent seam is derived from its transport SSOT instead of copied.**

  One field family — what a subagent job IS — was declared three times as independent shapes and carried
  between them by six hand-written object literals that nothing checked for totality. A field added to
  either side had to be hand-copied at every hop, and a miss compiled clean as a silent no-op. TYPE-003
  named this cause and derived one hop; the next two changes each dropped a field at a hop it had skipped
  (CORE-025's permission policy, and ANALYTICS-001's `usage`, dropped in the very commit that added it).

  ```ts
  // now, in @robota-sdk/agent-interface-transport
  export type ISubagentSpawnRequest = Omit<IAgentBackgroundTaskRequest, 'kind'>;
  export type ISubagentJobResult = Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>;
  ```

  All four projections collapse to spreads. `parentTaskId` and `providerProfile` now reach the runner
  because they exist on the source, not because someone remembered them.

  **Per package, classified against each barrel:**

  - **`agent-executor` (major)** — the barrel loses `ISubagentSpawnRequest` and `ISubagentJobResult` (they
    moved to their owner; re-publishing them here would be a pass-through re-export). `ISubagentJobStart`
    and `ISubagentJobHandle` rename `jobId` → `taskId`, `ISubagentJobStart` gains `worktree?`, and
    `ISubagentWorktreePrepareRequest` renames `jobId` → `taskId`.
  - **`agent-framework` (major)** — the barrel loses eleven type-only re-exports of `agent-executor`-owned
    types. They carried zero runtime values, so they bought none of the assembly convenience a runtime
    facade exists for, while making one field family look like it had three owners. Separately,
    `ISpawnAgentTaskRequest.permissionPolicy` goes optional → **required**.
  - **`agent-subagent-runner` (major)** — `ISubagentWorkerStartPayload` renames `jobId` → `taskId` and gains
    `worktree?`. This package is not in the item's declared `area:`; the audit that caught it is the reason
    it is here.
  - **`agent-interface-transport` (minor)** — two new barrel exports; nothing removed or renamed.
  - **`agent-core` (minor)** — **two** new barrel exports. `DEFAULT_BACKGROUND_PERMISSION_POLICY` is the
    intended one; collapsing the hand-listed permissions block to `export *` also surfaced
    `clearRegisteredToolArgumentKeys`, which the old list had omitted. It is documented as public rather
    than re-narrowed — a barrel that cannot fall out of step with its owner is the point of the collapse.
    Nothing was removed: all nine previously-listed permission types remain on the barrel.
  - **`agent-cli` (patch)** — migrated as the only in-repo implementer of `ISubagentWorktreeAdapter`; no
    barrel change.

  **`permissionPolicy` is now required at the spawn boundary**, and its default is one exported constant
  owned by the permission SSOT. It was previously applied as `?? 'inherit-allowlist'` in the middle of a
  projection, in **two** packages independently, with nothing keeping them equal — a security-relevant value
  whose default was declared twice. Every spawn site now states its own policy.

  **The worktree identity moved to the runner envelope.** It is runner-produced — the worktree does not
  exist when a caller builds a request — so it rides on `ISubagentJobStart.worktree` and crosses the IPC
  boundary there. The runner no longer also rewrites `request.cwd`, which had given ARCH-010's execution-root
  rule two carriers that could disagree. `branchName` **relocated rather than being deleted**: it has no
  reader in this repository today, and for a library that is not a reason to drop a legitimate contract.

  **Renames are consistent across the SPI** (`type` → `agentType`, `jobId` → `taskId`) rather than applied to
  one shape, which would have left two names for one identifier in a single file. The IPC validator's
  string-literal keys are now typed against the contract, so the next rename is a compile error instead of a
  runtime rejection of every start payload.

- 9fbab1b: Provider DIP Stage B (ARCH-PROVIDER-003), part 1: collapse infrastructure. Adds the
  provider-registry-driven `@robota-sdk/dag-node-llm-text` node that supersedes the
  per-vendor LLM nodes + router, relocates the provider config resolver into
  `agent-core`, adds SSOT cost/allowedModels fields, inverts the `llm-text` validator
  tombstone, and wires `createDagFramework({ providers })`. Additive — the per-vendor
  nodes still exist; consumer migration + their removal follow in part 2.
- b6d14ce: Make the universal JSON-schema subset able to express an object, so a nested `z.object()` keeps its
  properties and required fields instead of reaching the model as `{ "type": "object" }`. Tools and
  structured-output schemas with one level of nesting are now advertised in full and enforced on the
  tool-input path; `z.union` / `z.discriminatedUnion` / `z.literal` are supported and map to `anyOf`
  and single-value enums; `.nullable()` keeps its null branch; and Zod's `strip`, `strict` and
  `passthrough` modes stop collapsing into two `additionalProperties` emissions. Fixes the shipped
  `Computer` and `AskUserQuestion` built-ins, whose action and question fields were being dropped
  entirely.

  `agent-core` is **minor**, not patch: `IObjectParameterSchema` is a new export, and
  `IParameterSchema.type` became optional (a union node carries `anyOf` instead of a type), which is a
  consumer-visible type change — two call sites in this repo needed editing to keep compiling.
  `additionalProperties` also widened to `boolean | IParameterSchema`, and `required` and `anyOf` are
  new members. The provider packages are **patch**: each adapts to the widened subset without changing
  its own public surface.

### Patch Changes

- 7b6234c: A tool call whose arguments fail to decode to a JSON object (invalid JSON, or a `null`/scalar/array
  root — including a stream truncated mid-argument) no longer breaks the rest of its batch or the round
  after it. Every other call in the same batch still executes and gets its real result; the malformed
  call gets a clear per-call error instead, naming the tool and call id, and the run continues rather
  than rejecting. The Anthropic and Gemini providers no longer throw when building the next request
  from a conversation that still carries that call's original malformed arguments.
- a009f5b: Provider DIP Stage E (ARCH-PROVIDER-006): repo-hygiene + policy cleanup. Codified the
  Family Decomposition Rule in project-structure.md (split driver = consumer/third-party
  opt-in installability / extension-point registration, not dep-weight). Removed dangling
  tracked references to deleted packages (tsconfig project refs, eslint glob, changeset
  config `fixed` + pending changeset files), pruned 37 dead `.changeset/pre.json` entries,
  and removed 24 untracked husk directories. Closes ARL-15 — the provider dependency-
  inversion arc (Stages A–E) is complete.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- e477440: CORE-033: the abnormal paths now emit the required replay events, and history stays append-only

  `provider_request`, `assistant_message_committed` and `history_mutation` are REQUIRED families, and
  `agent-session` builds its session log from them: replaying every announced append, in order, is
  supposed to reconstruct the conversation. Three engine sites appended without announcing, so the
  reconstruction diverged at exactly the moments a reader goes to the log — the round cap, the
  hard-capacity block, and a provider failure. On a capped run the summary the user actually read was
  absent from every replay, and the provider call that produced it was invisible.

  - The forced-summary call emits `provider_request` (`forcedSummary: true`, carrying the assembled
    messages), then `assistant_message_committed` and `history_mutation` for the summary it commits.
  - The hard-capacity block announces its diagnostic — the only message explaining why the turn stopped.
  - A provider failure announces the `Request failed: …` record it appends.

  The forced-summary call also **rewrote** history: it appended a synthetic round-limit instruction,
  sent it, then removed it with `clear()` + re-add — a non-append mutation this vocabulary has no way
  to describe. The instruction is a per-call prompt artifact, so it no longer enters the conversation
  store at all; it exists only in the outgoing array, the same shape the structured-output transport
  uses for a schema instruction. Nothing is added, so nothing has to be removed, and `mutation` still
  needs no removal member.

  The item also reported that the streaming path emitted no families at all. CORE-042 had already
  fixed that by removing the second engine — `runStream` runs the same `execute()` — and this change
  adds the test that says so rather than leaving it assumed.

- 9dcb5da: CORE-035: the identical-tool-input loop guard throws a named error, and the SPEC now matches it

  The SPEC documented an `AbortError` thrown at the Nth identical call. The code threw a bare `Error`
  at the N+1th. The type difference was behavioral, not cosmetic: `isAbortFailure` resolves an
  `AbortError` as `success: true, interrupted: true`, so a run that detected a pathological loop and
  produced no answer would have been reported as a SUCCESS.

  Resolved toward the code's semantics and the SPEC's intent, which are not the same thing:

  - **Failure, not abort.** A guard trip is the agent giving up, not the user cancelling. `AbortError`
    means the caller asked the turn to stop, and here nobody did.
  - **Named, not bare.** `SameToolInputLoopError` (`code: 'SAME_TOOL_INPUT_LOOP'`, `category: 'system'`,
    `recoverable: true`) carries `toolName`, `callCount` and `maxSameToolInputs`. Naming a type is what
    the SPEC was reaching for: a caller must be able to tell "the agent looped" from "the network died",
    and CORE-027 carries those fields out intact.
  - **`maxSameToolInputs` is a MAXIMUM.** The Nth identical call is allowed; the N+1th trips. The SPEC's
    "N or more times" contradicted its own option name.

  `ErrorUtils` moves to `utils/error-utils.ts`, split from the class taxonomy it operates on — two
  responsibilities in one file, and keeping them together made the taxonomy file impossible to extend.
  Both remain exported from the package entry.

- a95ca85: Apply `config.systemMessage` on the streaming path. `runStream()` built its provider request straight
  from the conversation store and never entered the session initialization that attaches the system
  prompt, so an agent obeyed its persona through `run()` and ignored it through `runStream()` — silently,
  on the default interactive surface. An agent used through both entry points only acquired its prompt
  from the first non-streaming turn onward.

  The streaming path now enters the same `initializeConversationStore` the round path enters, so the
  prompt, the inject-once rule and the conversation restore are owned in one place. Contained under
  CORE-042, which is the duplication itself.

- 0382a51: CORE-041: `z.nativeEnum()` and `z.date()` convert; the rest of the boundary is published, not discovered

  `zodToJsonSchema` threw `Unsupported Zod type: …` on five constructs, so a schema Zod accepts could
  not be turned into a tool or a structured-output spec. Re-running the decision the item reserved,
  those five are two different problems:

  - **`ZodNativeEnum` and `ZodDate` are exactly expressible** and were missing for no reason.
    A native enum becomes an `enum` of its VALUES — for a numeric TypeScript enum the compiler's
    reverse mapping is filtered out, so a field accepting `0` is no longer advertised as accepting
    `"Low"`. A date becomes `{ type: 'string', format: 'date-time' }`, which is not a lossy stand-in:
    JSON has no date type, so a string is what the provider receives either way.
  - **`ZodTuple`, `ZodIntersection` and `ZodLazy` are not expressible**, and still throw. A tuple needs
    positional `items` (the subset models `items` as one schema), an intersection needs `allOf`,
    recursion needs `$ref` — none of which the field-enumerated provider mappers would forward.
    Adopting `zod-to-json-schema` does not dissolve this, as CORE-039 had conceded it might: the
    library emits exactly those constructs. The difficulty was never parsing Zod; the target language
    cannot say these things.

  Mapping them lossily was rejected — a tuple flattened to `array of anyOf[...]` would tell the model
  that any order and any length are acceptable, a contract the author did not write.

  The error now names the construct, says why the subset cannot carry it, and names a Zod expression to
  write instead. `Unsupported Zod type: ZodTuple` told a consumer the name of their own construct and
  nothing they could act on.

- 93d061d: CORE-043: structured output now knows which transport can carry the schema before the first call

  `run(input, { output })` asked every provider for `responseFormat: { type: 'json_schema' }`. A
  provider whose surface cannot express that accepted the option and dropped it — and the schema was
  stated in words only by the RETRY feedback turn, which runs on attempt two. So against such a
  provider, attempt one carried nothing describing the required shape and could only succeed by luck:
  the advertised three attempts were really two, and the first was spent discovering something the
  capability table already knew.

  A `(provider, model)` pair now resolves to a mechanism (`response_schema` / `json_object` / `none`)
  and a provenance (`catalog` / `vendor-default` / `undeclared` / `unverified-endpoint`), and the
  request is shaped to match at the one seam that holds both the resolved provider and the outgoing
  messages. When the wire cannot carry the shape, the schema is stated in the prompt on the FIRST
  attempt. Each structured request emits a `structured_output_transport` event reporting what the
  request actually did.

  - `IAIProvider.endpointIsVendorDefault?()` — a provider configured with a custom `baseURL` reports
    it, so the runtime stops claiming enforcement a gateway may not provide. Separate from
    `capabilityTable?()` on purpose: `@robota-sdk/agent-provider-openai` declares no table (nobody has
    verified one) and must still be able to answer.
  - DeepSeek's capability table declared `json_schema`; DeepSeek guarantees the response PARSES but
    takes no schema parameter. Corrected to `json_object`.
  - A provider that declares nothing is still sent the request unchanged — silence is not a denial.

- 39554a1: CORE-047: the model-configuration API is reachable before the first turn

  `getModel()`, `setModel()` and `swapDefaultProvider()` refused on a freshly constructed agent with
  `Agent must be fully initialized before ...`. So you had to ask the model a question before you could
  ask which model you were using.

  The state they guarded — the provider registry and the current `(provider, model)` pair — turned out
  to be synchronous and derived entirely from config the constructor had already validated. It merely
  lived inside the async initializer, next to work that genuinely is async (modules, plugins, the
  execution service). Both steps now run in the constructor, so an agent knows which model it is
  configured for from the moment it exists, and the readiness guard on those three methods protected
  nothing and is gone.

  A destroyed agent still refuses — and now says so accurately (`AIProviders was disposed`) instead of
  misreporting teardown as missing initialization.

  `Robota.ensureReady()` is unchanged and remains the way to complete the asynchronous half without
  running a turn. It is no longer a precondition for reading or changing the model.

- d28430a: CORE-048: `resolveStructuredOutputCapability` is exported

  `TStructuredOutputMechanism` and `TStructuredOutputProvenance` were already public while the function
  that produces them was not — a caller could name the answer but not obtain it. Exporting it also lets
  a consumer ask, before spending a call, what will happen to their schema against a given
  `(provider, model)` pair.

  No behaviour changed. This falls out of CORE-048, which asked whether a forced tool call should join
  the mechanism vocabulary and answered no: the transport would need a provider that both lacks a
  schema parameter and has enforceable strict tool arguments, and across this workspace that
  intersection is empty.

- 07b627f: A local peer can now be answered, and what its turn may do depends on where it runs.

  - `agent-core`: the permission evaluator takes a peer turn's authority as one more input
    (`IPermissionEvaluationContext.peerTurn`), decided after the deny list and ceiling and before
    bypass and allow rules. A peer on another host uses no tool. A peer on the same host may use an
    inspect-class tool that declares `workspacePaths`, only when every named location resolves inside
    the workspace and is not a credential (`isSecretPath`); write and execute tools are refused unless
    enabled, and then every use asks. A tool declaring `repliesToPeer` exists only in a peer turn and
    asks once the turn used another tool. New: `isToolAvailableInPeerTurn`, `TPeerReach`,
    `IPeerTurnAuthority`. `IRunOptions.withholdHostedTools` leaves a provider's hosted tools out of a
    run's requests (`nativeWebTools` with `false` withholds a hosted tool for one call).
  - `agent-tools`: `Read` and `Glob` declare the arguments that say where they look. `Grep` does not:
    it reads files it was never named, so a peer turn does not get it.
  - `agent-session`: `ISessionRunOptions.peerReach` makes a run a peer turn for the permission policy;
    every ask in it needs a fresh approval, and its requests carry no provider-hosted tool. `ISessionOptions.allowPeerChanges` enables write and execute
    tools for same-host peer turns.
  - `agent-interface-session`: `ISubmitOptions.peer` (`IPeerTurnContext`) carries a peer turn's reach,
    the message it answers and the session a reply goes to.
  - `agent-interface-session-mobility`: `IPeerMessage.inReplyTo` threads a conversation;
    `peerReachOf(admission)` maps admission to a reach.
  - `agent-framework`: a peer turn is offered what its origin allows, and a new `peer_reply` tool
    answers the peer that sent the message, threaded to it. The setting `peers.allowChanges` enables
    write and execute tools for same-host peer turns.
  - `agent-ui-terminal`: a permission prompt in a peer turn names the requesting peer.
  - `agent-cli`: incoming peer turns carry their reach and reply route; a conversation is limited in
    depth and in how often this session answers it, and a reply over a limit is not sent and the
    operator is told.
  - `agent-provider-anthropic`, `agent-provider-openai-compatible` (Qwen): a request whose
    `nativeWebTools` sets a hosted tool to `false` is sent without it.

- d0de5b2: A peer session's message now reaches the model as a peer's, and a peer turn runs on the external
  baseline.

  - `agent-core` marks every user message whose driver id starts with `peer:` as
    `<peer_message from="…">…</peer_message>` in the outgoing request — both the round and the forced
    summary — while the stored history keeps the text as sent. Wrapper-shaped text in user and tool
    messages is escaped, and an id that is not a plain identifier is printed as `peer:unverified`.
    New exports: `peerDriverOf`, `printablePeerDriver`.
  - `agent-session`'s conversation transcript (compaction, advisor) labels a peer message with the same
    printable id, so no rendering echoes a sender-chosen id that is not a plain identifier.
  - `agent-framework` runs a `peer` turn like an `external` one — no tools (`toolChoice: 'none'`), no
    `@path` expansion, no context references — and adds a per-turn system statement that the message
    came from another session and carries no authority. A `peer` turn must carry a `peer:` driver id.

- d6b9404: Remove polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) from three parsers whose input is not repo-controlled.

  `parseStructuredResponseText` (agent-core) parses raw model output; its fenced-code-block regex used `\s*\n`, and because `\s` also matches a newline the two overlapped, so an unterminated fence containing many blank lines was rejected in O(n^2) — 12.7s for a 400 KB string, now ~1ms. The whitespace run is now restricted to horizontal whitespace, which makes the newline split point unique.

  `/schedule cron` and `/monitor` (agent-command) are declared `modelInvocable: true`, so their argument string is composed by the model. Both matched the trailing instruction with `\s+(.+)$`; since `.` also matches a space the split point was ambiguous and a non-matching argument cost O(n^2) — ~15s for a 200 KB argument, now <1ms. The instruction is now required to start with a non-space character, which pins the split point without changing which inputs are accepted.

  No behaviour change: the set of accepted inputs and the parsed values are identical in every case.

- 9814afc: Type-SSOT convergence (TYPE-003; re-audit CONTRACT-002/003/011/012 + RUNTIME-47 + STRUCT-04). Behavior is unchanged — this is a type-level refactor. `ITokenUsage` (agent-core) is confirmed as the usage-triple SSOT: `ISessionUsageTotals` and `IBackgroundTaskUsage` become aliases, and every inline `{ promptTokens; completionTokens; totalTokens }` copy (service/orchestration/executor/remote-client shapes) now references the SSOT (structurally identical → patch). The subagent-job contracts derive from the background-task SSOT — `TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick`-projection `ISubagentJobState` — with a compile-enforced parity test so a drifting hand copy can no longer exist. `@robota-sdk/agent-session` is minor because the public `ISessionRecord` type is now the typed `IInteractiveSessionRecord` alias (previously a relaxed `unknown[]` mirror): runtime behavior of `SessionStore` is identical, but downstream code that assigned loose payloads to the record's fields may need explicit casts at its own trust boundary (the framework store facade's `as unknown as` cast bridge is deleted). agent-session's duplicate `@robota-sdk/agent-core` deps/devDeps declaration is also removed (STRUCT-04).

## 3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- 6f308d1: fix(streaming): expose token usage on the streaming execution path (BEHAVIOR-005)

  Token usage was silently dropped on streaming turns, so `readTokenUsageFromMessage` and robota's usage analytics returned empty/0 for every `run()`/`runStream()` (which always stream). OpenAI-compatible streaming requests now send `stream_options: { include_usage: true }`, the stream assembler and the `runStream` commit path attach the same top-level `usage` shape the non-streaming path already emits, and both `run()` and `runStream()` now expose usage. New opt-out `IOpenAIProviderOptions.includeStreamUsage` (default `true`) for OpenAI-compatible servers that reject `stream_options`.

## 3.0.0-beta.77

### Patch Changes

- Coordinated beta.77 release. Runtime hardening across the session/execution/subagent stack
  (CORE-019..024: compaction-failure contract, strict execution error propagation, plugin/timer
  disposal, process-tree kill via the new `@robota-sdk/agent-process`, scheduler & IPC integrity),
  TUI shutdown/channel hygiene (CLI-075: listener unwiring, permission-queue drain, timeout-bounded
  graceful shutdown, second-signal force-quit), and agent-cli decoupled from the unpublished
  DAG/workflow chain so the published CLI installs cleanly (CLI-077). First publish of
  `@robota-sdk/agent-process`.

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `TContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
- DQ-AUDIT-006 — error/observability hygiene: replace raw `throw new Error()` on core-service and provider hot paths with typed `RobotaError` subclasses (`ConfigurationError`/`ValidationError`) so error-handling can branch on category/recoverable; surface fire-and-forget hook failures via `logger.warn` instead of silent `.catch(() => {})`; wire the error-handling plugin's `totalRetries`/`successfulRecoveries` stats to real counters.
- DQ-AUDIT-007 — remove the silent `model || 'gpt-4o-mini'` default in the OpenAI streaming handler (a missing model now throws `ConfigurationError` instead of substituting a vendor default); document `IAIProvider`'s universal (`chat`) vs raw (`generateResponse`) dual surface as intentional in the agent-core SPEC.
- 576af62: Fix `ConfigurationError: Agent must be fully initialized before changing model configuration` when running `/preset` (or any live model re-apply) on a fresh interactive session before the first message. The Robota agent initialized lazily on the first `run()`, but `setModel` requires full initialization. `Session.applyModelOptions` now awaits the new idempotent `Robota.ensureReady()` before `setModel`, and the preset live-switch path (`applyPresetToSession` → `executePresetCommand`) is async end-to-end. Adds a real cold-session regression test (no mocked Robota).

## 3.0.0-beta.75

### Patch Changes

- Agent preset system + live preset switching + context/history correctness fixes.

  - **Preset system (PRESET-001~017):** new `@robota-sdk/agent-preset` package layering framework
    assembly options into named, selectable profiles (`default`, `autonomous-builder`, `careful-reviewer`,
    `neutral-executor`) plus user-authored external presets loaded from `~/.robota/presets/*.json`.
  - **Live preset switching:** `/preset` command (list + active marker + switch) and a TUI active-preset
    display. Switching live re-applies permission posture, model/effort, persona, command-module
    selection, parallel-subagents gating, and a self-verification system-prompt section via the single
    `applyPresetToSession` engine.
  - **CTX-001:** the TUI Context display + session auto-compact now use the accurate provider-based token
    estimate (system prompt + tool schemas included) instead of a crude history-only char heuristic.
  - **HIST-001:** conversation history is now append-only — removed the silent 100-message count cap that
    could drop early context; context size is managed solely by size-based compaction.

## 3.0.0-beta.74

## 3.0.0-beta.73

## 3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate

## 3.0.0-beta.70

## 3.0.0-beta.69

## 3.0.0-beta.68

## 3.0.0-beta.67

## 3.0.0-beta.66

## 3.0.0-beta.65

## 3.0.0-beta.64

## 3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Add CLI second-screen browser monitor (PLG-002)
  - New `@robota-sdk/agent-web` package: WebSocket client, `useWsSession` hook, `SessionMonitor` component with Markdown rendering
  - `--web` flag on `agent-cli`: starts WebSocket sidecar server and auto-opens browser monitor
  - `--no-open` flag and `ROBOTA_NO_OPEN` env var to suppress browser launch
  - `user_message` event added to `IInteractiveSessionEvents` so user prompts stream to browser in real-time
  - `TServerMessage` protocol extended with `user_message` type

## 3.0.0-beta.61

### Patch Changes

- 1c0d44c: Align context usage estimation across session display, auto-compaction, and core hard-capacity guards so mid-window sessions do not block prematurely.
- 36eb7a9: Add provider-owned native replay payload hooks, replay validation coverage, and a session log validation command.
- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.

## 3.0.0-beta.60

### Minor Changes

- 7439391: Add provider-neutral native web search/fetch capability contracts, explicit unsupported handling for OpenAI-compatible/LM Studio profiles, and local WebFetch/WebSearch permission/documentation alignment.

## 3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and robota.io content for the beta 57 feature set.

## 3.0.0-beta.57

### Minor Changes

- f61e2cb: Add Qwen provider-owned Responses API support for built-in web search/fetch tools and pass provider-owned profile options through generic CLI/runtime configuration.

### Patch Changes

- 16c3b6f: Persist and render provider-neutral per-turn usage summaries with pre-send context updates in CLI sessions.

## 3.0.0-beta.56

### Patch Changes

- Prepare a coordinated beta release for batch npm publishing.

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- fix: PR #69 code review — session resume tool messages, type SSOT, fork isolation, settings crash, Notification removal, chat validation

## 3.0.0-beta.52

## 3.0.0-beta.51

## 3.0.0-beta.50

## 3.0.0-beta.49

## 3.0.0-beta.48

## 3.0.0-beta.47

## 3.0.0-beta.46

## 3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- feat: IHistoryEntry universal history architecture + test quality cleanup
  - IHistoryEntry as universal history type across all 4 packages (core → sessions → sdk → cli)
  - Tool summary stored as event entry in history (category: 'event', type: 'tool-summary')
  - TuiStateManager pure TypeScript class for CLI rendering state
  - MessageList renders IHistoryEntry[] with Tool:/System:/You:/Robota: labels
  - Display order fixed: Tool → Robota (both streaming and abort)
  - Remove 25 tautological, duplicate, and hardcoded tests

## 2.0.9

### Patch Changes

- Add environment-specific builds and conditional exports for optimal browser compatibility

  This update introduces major build optimizations for better browser performance:

  ## 🚀 Environment-Specific Builds
  - **Node.js builds**: `dist/node/` with full ESM and CJS support
  - **Browser builds**: `dist/browser/` with optimized ESM bundles
  - **Automatic selection**: Bundlers automatically choose the right build

  ## 📦 Bundle Size Optimizations
  - **team package**: 36% smaller browser bundles (37.52KB → 24.12KB)
  - **sessions package**: 48% smaller browser bundles (10.64KB → 5.55KB)
  - **Tree-shaking**: Eliminates Node.js-specific code from browser builds
  - **Production optimizations**: Removes console logs and debug code in browser builds

  ## 🔧 Conditional Exports

  All packages now support conditional exports for seamless environment detection:

  ```json
  {
    "exports": {
      "node": "./dist/node/index.js",
      "browser": "./dist/browser/index.js",
      "default": "./dist/node/index.js"
    }
  }
  ```

  ## 🌐 Enhanced Browser Support
  - **Zero breaking changes**: Existing code continues to work unchanged
  - **Better performance**: Optimized bundles for faster loading
  - **Smaller footprint**: Reduced JavaScript bundle sizes for web applications
  - **Universal API**: Same API works across all environments

  This update completes the browser compatibility optimization phase, making Robota SDK production-ready for web applications with optimal performance characteristics.

## 2.0.8

### Patch Changes

- # Model Configuration Refactoring

  ## 🚀 **Breaking Changes**

  ### **Provider Interface Simplification**
  - **OpenAI Provider**: Removed `model`, `temperature`, `maxTokens`, `topP` from provider options
  - **Anthropic Provider**: Removed `model`, `temperature`, `maxTokens` from provider options
  - **Google Provider**: Removed `model`, `temperature`, `maxTokens` from provider options
  - **All Providers**: `client` is now optional, automatically created from `apiKey`

  ### **Centralized Model Configuration**
  - Model configuration is now exclusively handled through `defaultModel` in Robota constructor
  - Providers are simplified to handle only connection-related settings
  - Runtime model switching via `setModel()` method is now the recommended approach

  ## ✨ **Improvements**

  ### **Simplified Provider Creation**

  ```typescript
  // Before
  const provider = new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-3.5-turbo',
  });

  // After
  const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
  });
  ```

  ### **Enhanced Validation**
  - Added strict validation for required model configuration
  - Removed default model fallbacks to prevent ambiguous behavior
  - Clear error messages when model is not specified

  ### **Documentation Updates**
  - Updated all README files with new usage patterns
  - Regenerated API documentation
  - Updated all example files (11 examples)

  ## 🔧 **Migration Guide**
  1. **Remove model settings from Provider constructors**
  2. **Use `apiKey` instead of `client` injection (recommended)**
  3. **Ensure `defaultModel` is properly configured in Robota constructor**
  4. **Update any hardcoded model references to use runtime switching**

  ## 🎯 **Benefits**
  - **Eliminates configuration confusion** - Single source of truth for models
  - **Simplifies provider setup** - Just provide API credentials
  - **Enables better runtime control** - Centralized model management
  - **Improves consistency** - All providers follow same pattern

## 2.0.7

### Patch Changes

- Browser compatibility improvements
  - feat: Implement SimpleLogger system to replace direct console usage for better browser compatibility
  - feat: Centralize SimpleLogger in @robota-sdk/agent-core package and export for other packages
  - feat: Add support for silent and stderr-only logging modes via SilentLogger and StderrLogger
  - refactor: Update all packages (@robota-sdk/agent-provider-openai, @robota-sdk/agent-provider-anthropic, etc.) to use centralized SimpleLogger
  - chore: Add ESLint rules to prevent direct console usage while allowing legitimate cases
  - fix: Remove unused AIProvider import from examples to clean up warnings

  These changes ensure the SDK works properly in browser environments by removing Node.js-specific console behavior while maintaining full backward compatibility.

## 2.0.6

### Patch Changes

- Add browser compatibility by removing Node.js dependencies
  - Replace NodeJS.Timeout with cross-platform TimerId type
  - Remove process.env dependency from logger configuration
  - Replace Node.js crypto module with jsSHA library for webhook signatures
  - Update OpenAI stream handlers to work in browser environments
  - Maintain 100% backward compatibility with existing Node.js applications

  This update enables Robota SDK to run seamlessly in both Node.js and browser environments without breaking changes.

## 2.0.5

### Patch Changes

- ## 🎯 TypeScript Declaration File Optimization

## 2.0.4

### Patch Changes

- 9f17ac6: Restore README.md files and prevent deletion during build process

## 2.0.3

## 2.0.2

### Patch Changes

- Fix npm package documentation by ensuring README.md files are included

## 2.0.1

### Patch Changes

- Remove unused dependencies from agents and sessions packages

## 2.0.0

### Major Changes

- a3a464c: # Robota SDK v2.0.0-rc.1 - Unified Architecture

  ## 🚀 Major Changes

  ### New Unified Core
  - **@robota-sdk/agent-core**: New unified core package consolidating all functionality
  - **Zero `any` types**: Complete TypeScript type safety across all packages
  - **Provider-agnostic design**: Seamless switching between OpenAI, Anthropic, and Google

  ### Key Features
  - **Multi-Provider Support**: Dynamic provider switching with type safety
  - **Advanced Function Calling**: Type-safe tool system with Zod validation
  - **Real-time Streaming**: Improved streaming with proper error handling
  - **Task Delegation**: Improved delegated workflow support
  - **Plugin Architecture**: Comprehensive plugin system with facade pattern

  ### Breaking Changes
  - `@robota-sdk/core` functionality moved to `@robota-sdk/agent-core`
  - Redesigned provider interfaces with generic type parameters
  - Updated agent configuration format

  Complete architecture overhaul focused on type safety and developer experience.
