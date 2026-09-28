---
title: Model Context Protocol (MCP)
description: Connect the robota CLI to remote MCP servers, sign in with OAuth, serve a Robota session to other MCP clients with robota mcp serve, and admit verified external events.
---

# Model Context Protocol (MCP)

The [Model Context Protocol](https://modelcontextprotocol.io) lets an agent use tools that other
programs serve, and lets other programs use an agent. Robota does both:

- **As a client**, the `robota` CLI reads MCP server definitions from your settings and offers the
  servers' tools to the model, once you approve each server (and sign in, for OAuth servers).
- **As a server**, `robota mcp serve` exposes one Robota session to another MCP client — over stdio,
  authenticated loopback HTTP, or as an OAuth-protected remote HTTP endpoint.

The same building blocks are libraries: [`@robota-sdk/agent-mcp`](../../packages/agent-mcp/docs/README.md)
(client: definitions, approval, connections, OAuth) and
[`@robota-sdk/agent-transport-mcp`](../../packages/agent-transport-mcp/docs/README.md) (server).
This guide covers the CLI.

The last section covers **external events** — how an outside system can start a turn in a session.
That is deliberately not done over MCP.

## Prerequisites

- The `robota` CLI installed — see [Getting Started](../getting-started/README.md).
- MCP servers defined in project settings, and `robota mcp serve`, need a **trusted workspace**
  (`robota trust --yes`; see [Workspace trust](./sessions-and-daemon.md#workspace-trust)). Servers in
  your user settings do not.
- Signing in, approving servers and choosing grants are your actions: the model can read `/mcp`
  status and suggest the command, but cannot run them.

## Using MCP servers in the CLI

### What the CLI can connect

Read this first. `/mcp approve <server>` connects the server in the session where you run it, and
the approval is kept in `~/.robota/mcp-approvals.json`, so the server also connects at later starts
until its definition, its source or the workspace changes. So:

| Server definition                                   | In the `robota` CLI                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Remote (`"type": "http"`) with `oauth`              | Connects once you run `/mcp approve <server>` and then `/mcp login <server>`.                                                         |
| Remote without `oauth` (static headers or a helper) | Connects once you run `/mcp approve <server>`; a helper must also be allowed (see below).                                             |
| `stdio`                                             | Listed in `/mcp`; refused with `missing host authority`. The executable supplies no authority to start a local process from settings. |
| `sse`, `ws`                                         | Listed, never connected. Only Streamable HTTP and stdio are supported.                                                                |

An application that embeds the CLI through `startCli()` from `@robota-sdk/agent-cli` can supply its
own approval store (`mcpApprovalStore`) in place of that file, and per-server stdio authorities
(`mcpStdioAuthorities`); with those, approved stdio servers connect too.

### Where definitions live

Servers are defined under an `mcpServers` key in the same settings files as the rest of Robota's
configuration:

| File                                                         | Scope                              |
| ------------------------------------------------------------ | ---------------------------------- |
| `~/.robota/settings.json`, `~/.claude/settings.json`         | user                               |
| `.robota/settings.json`, `.claude/settings.json`             | project (loaded only when trusted) |
| `.robota/settings.local.json`, `.claude/settings.local.json` | local (loaded only when trusted)   |

When the same server name appears in more than one scope, the whole entry from the highest scope wins
— local over project over user — and entries are never merged field by field. The CLI connects only
servers defined in these files; a plugin's own `.mcp.json` is not one of them.

### Defining a server

Every entry needs a `type`. A remote server:

```json
{
  "mcpServers": {
    "tracker": {
      "type": "http",
      "url": "https://mcp.tracker.example.com/mcp",
      "oauth": {}
    }
  }
}
```

`"oauth": {}` is enough for a server that publishes its authorization metadata and accepts dynamic
client registration. For a pre-registered client, give `clientId` and the fixed `callbackPort` it
redirects to.

| Field           | Applies to | Meaning                                                                                                                          |
| --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | all        | `"stdio"`, `"http"` (also spelled `"streamable-http"`), `"sse"` or `"ws"`. Required.                                             |
| `command`       | stdio      | Executable to run. Required for stdio.                                                                                           |
| `args`          | stdio      | Array of string arguments.                                                                                                       |
| `cwd`           | stdio      | Working directory.                                                                                                               |
| `url`           | remote     | Server endpoint. Required for remote types.                                                                                      |
| `headers`       | remote     | Object of static request headers.                                                                                                |
| `headersHelper` | remote     | `{ "command": "/absolute/path", "args": [...] }` — a program whose output (a JSON object of headers) is sent as request headers. |
| `oauth`         | remote     | `{ "clientId", "callbackPort", "authServerMetadataUrl", "scopes" }`, all optional; `clientId` needs `callbackPort`.              |
| `env`           | stdio      | Object of environment values for the process.                                                                                    |
| `timeout`       | all        | Positive number of milliseconds.                                                                                                 |

`command`, `args`, `cwd`, `env`, `url` and `headers` may use `${VAR}` and `${VAR:-default}`, filled
from the environment. An unset variable with no default is reported and left as literal text rather
than replaced with an empty string. `oauth` and `headersHelper` take no templates, `oauth` rejects
unknown keys, and a client secret is never accepted in a definition.

A header helper runs only if its exact command and arguments are listed under `mcpHeaderHelpers` in
your **user** settings (a project cannot add to the list):

```json
{
  "mcpHeaderHelpers": [{ "command": "/usr/local/bin/mcp-token", "args": ["--server", "internal"] }]
}
```

A definition with problems is reported at startup, one line each, and shown in `/mcp`; it never
silently disappears.

### Walkthrough: approve, sign in, use the tools

Start `robota` and check the servers:

```text
/mcp
```

Each server is one line: name, approval state, scope, reason and, for OAuth servers, the sign-in
state. A new server is `pending`. Approve it, then sign in:

```text
/mcp approve tracker
/mcp login tracker
```

`/mcp login` shows the authorization URL and asks before opening your browser. Without a usable
browser, add `--no-browser`: you open the URL yourself and paste the address the browser was sent to
into the session's masked prompt. On success:

```text
Signed in to MCP server tracker; 5 of its tools are available from your next message.
```

The tools appear to the model as `<server>__<tool>`, for example `tracker__create_issue` (names are
reduced to letters, digits, `_` and `-`, and shortened with a stable hash when too long). They go
through the same [permission rules](./permissions-and-hooks.md) as every other tool:
`"allow": ["tracker__*"]` allows all of one server's tools, and a deny rule naming a tool removes it
from the model's tool list.

Sign out and revoke the tokens with `/mcp logout tracker`.

### Signing in from a terminal

```bash
robota mcp login tracker               # opens the browser; keeps the tokens for later sessions
robota mcp login tracker --no-browser  # prints the URL; you paste the redirect back
robota mcp login tracker --client-secret  # pre-registered client: asks for its secret without echo
robota mcp logout tracker              # deletes the tokens, then asks the server to revoke them
```

A client secret is asked for only here, never inside a session, because what you type in a session
becomes part of the conversation.

### Long-running tool calls

| Setting                | Default           | Meaning                                                                                                        |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `mcp.autoBackgroundMs` | `120000` (2 min)  | After this long, an MCP tool call is handed to a background task so the turn can continue. `0` turns this off. |
| `mcp.callTimeoutMs`    | `600000` (10 min) | Upper bound for one MCP tool call.                                                                             |

Both are read from the same settings files as `mcpServers`, each key on its own. A negative or
non-integer value discards that file's whole `mcp` object. If `autoBackgroundMs` is not smaller than
`callTimeoutMs`, the handoff is off and a diagnostic says so. Print mode (`-p`) never hands off; a
call there runs to completion, bounded by `callTimeoutMs`.

## Serving a Robota session over MCP

`robota mcp serve` runs one Robota session as an MCP server, in the directory you start it from. It
passes the same trust check as other headless starts. All notices go to stderr; stdout carries only
MCP frames.

The server offers the session's tools under their own names, plus `robota_submit`, which takes
`{ "prompt": "..." }`, runs a turn and returns its response. It does not advertise MCP resources or
prompts. There is nobody to answer a permission prompt, so a call that would ask fails as a tool
error — allow what the client should use with [permission rules](./permissions-and-hooks.md).

### stdio

```bash
robota mcp serve
```

Configure your MCP client to launch this command with the project directory as its working
directory. Anything that can write to its stdin already runs as you, so stdio has no further
authentication.

### Loopback HTTP with a bearer token

```bash
robota mcp serve --http-token-file /home/me/.robota/mcp-token
# stderr: MCP HTTP listening at http://127.0.0.1:<port>/...; bearer token file: /home/me/.robota/mcp-token
```

The token file path must be absolute and must not exist yet. Robota creates it owner-only (`0600`),
writes a fresh token into it, and removes it on shutdown. The server binds `127.0.0.1` only and
checks the `Host` and `Origin` headers and the bearer token before reading a request. Add
`--http-port <port>` for a fixed port.

### Remote HTTP as an OAuth resource server

```bash
robota mcp serve \
  --http-public-url https://agent.example.com/mcp \
  --oauth-issuer https://auth.example.com \
  --oauth-scopes mcp:use \
  --oauth-allowed-subjects alice,bob \
  --http-host 10.0.0.5 --http-port 8443 \
  --trusted-proxy 10.0.0.1
```

The four `--http-public-url`/`--oauth-*` flags are required together, and this mode never uses a
token file. Every request needs an access token from the issuer that carries every listed scope and
names an allowed subject. A proxy in front must forward the paths under the public URL unchanged and
preserve `Host`. A refused request gets an empty body with a standard `WWW-Authenticate: Bearer`
challenge (401, or 403 `insufficient_scope`) and no detail. All allowed subjects share **one**
session.

## External events

An external event lets an outside system — a CI job, a monitoring alert — start a turn in a running
session. MCP servers are never a source of turns: a server connection proves nothing about who wrote
a message. Instead, each event must carry an access token that the session itself verifies against a
**grant** you give it at start.

A grant is a JSON file of public configuration only (at most 16 KiB):

```json
{
  "grantId": "ci-alerts",
  "issuer": "https://auth.example.com",
  "resource": "https://agent.example.com/events/ci-alerts",
  "client": "ci-bot",
  "scopes": ["events:write"],
  "rate": [{ "windowMs": 60000, "maxTurns": 5 }]
}
```

| Field                   | Meaning                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `grantId`               | 1–64 characters of `A-Z a-z 0-9 _ -`; also the grant's label.                        |
| `issuer`                | `https://` authorization server whose tokens are accepted.                           |
| `resource`              | `https://` URL ending in `/events/<grantId>`; the endpoint and the tokens' audience. |
| `subject` _or_ `client` | Exactly one: the one principal the grant admits.                                     |
| `scopes`                | Scopes every token must carry.                                                       |
| `algorithms`            | Optional subset of `RS256`, `ES256`, `EdDSA`.                                        |
| `rate`                  | Optional, 1–8 windows of `{ "windowMs", "maxTurns" }`.                               |

Any other field is refused. Start the TUI or a background session with the grant and a loopback port:

```bash
robota --external-event-grant ./ci-alerts.json --external-event-port 8787
robota session start --background --external-event-grant ./ci-alerts.json --external-event-port 8787
```

Your own HTTPS proxy or tunnel serves the grant's `resource` URL and forwards to
`127.0.0.1:8787` (add `--external-event-trusted-proxy <ip>` so its `X-Forwarded-For` is believed).
The sender posts:

```text
POST https://agent.example.com/events/ci-alerts
Authorization: Bearer <access token>

{"kind": "message", "conversationId": "build-4312", "content": "Nightly build failed on main."}
```

An admitted event is answered `202` with the turn id. Refusals have an empty body: 401 for a missing
or invalid token, 403 for a missing scope or a revoked grant, 400 for a malformed event, 404 for an
unknown grant, 413 for a body over 16 KiB, 429 over the rate limit, 503 when the issuer or session
cannot take it. The token must carry `jti` and `exp`, and each token is accepted once.

The turn an event starts has **no tools and cannot reply**. A name in the payload (`claimedName`) is
shown only as a claim and never used to decide who sent it.

List and withdraw grants with `/events` and `/events revoke <grant-id>` in the session, or, for a
background session, `robota session events list <id>` and `robota session events revoke <id>
<grant-id>`. Grants are created only by the start flags; the model can neither list nor change them.

## Reference

### Commands

| Command                                                    | What it does                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/mcp` or `/mcp status`                                    | Every server's name, approval state, scope, reason and OAuth sign-in state. The model may run it. |
| `/mcp approve <server>`                                    | Trust a server, connect it now, and keep the approval for later sessions.                         |
| `/mcp reload`                                              | Retry every server that is not connected, and add the tools of those that connect.                |
| `/mcp reject <server>`                                     | Refuse a server.                                                                                  |
| `/mcp revoke <server>`                                     | Withdraw an earlier approval.                                                                     |
| `/mcp login <server> [--no-browser]`                       | Sign in to an OAuth server and connect it in this session.                                        |
| `/mcp logout <server>`                                     | Sign out and revoke the tokens.                                                                   |
| `robota mcp login <name> [--client-secret] [--no-browser]` | Sign in from a terminal; tokens are kept for later sessions.                                      |
| `robota mcp logout <name>`                                 | Sign out from a terminal.                                                                         |
| `robota mcp serve [options]`                               | Serve one session over stdio, loopback HTTP or remote HTTP.                                       |
| `/events`, `/events revoke <grant-id>`                     | List or withdraw this session's external-event grants.                                            |

Approval states: `approved`, `pending` (no decision yet), `rejected`, `revoked`, `stale` (the
definition, its source or the workspace changed since approval), `untrusted` (a project or local
definition in an untrusted workspace). Sign-in states: signed in, token expired (will refresh),
sign-in required, signed out.

### `robota mcp serve` flags

| Flag                             | Meaning                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| _(none)_                         | stdio.                                                                           |
| `--http-token-file <path>`       | Loopback HTTP; write the bearer token to this new, absolute, owner-only file.    |
| `--http-port <port>`             | HTTP port (default: chosen by the OS).                                           |
| `--http-host <ip>`               | Address to bind (default `127.0.0.1`). Anything else requires the remote flags.  |
| `--http-public-url <https>`      | Remote mode: the public URL clients use; endpoint and metadata paths follow it.  |
| `--oauth-issuer <https>`         | Remote mode: authorization server whose access tokens are accepted.              |
| `--oauth-scopes <a,b>`           | Remote mode: scopes every token must carry.                                      |
| `--oauth-allowed-subjects <a,b>` | Remote mode: token subjects admitted to the one shared session.                  |
| `--trusted-proxy <ip>`           | Remote mode: believe `X-Forwarded-For` from this proxy (literal IP; repeatable). |

### External-event flags

| Flag                                  | Meaning                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `--external-event-grant <file>`       | Admit events for this grant (repeat per grant). TUI and `session start --background` only. |
| `--external-event-port <port>`        | Required with grants: the loopback port your proxy forwards to.                            |
| `--external-event-trusted-proxy <ip>` | A proxy whose `X-Forwarded-For` is believed (repeatable).                                  |

### Settings and files

| Key or path                                 | Meaning                                                  |
| ------------------------------------------- | -------------------------------------------------------- |
| `mcpServers`                                | Server definitions, in any settings file listed above.   |
| `mcpHeaderHelpers`                          | Allowed header-helper command lines; user settings only. |
| `mcp.autoBackgroundMs`, `mcp.callTimeoutMs` | Tool-call handoff threshold and time limit.              |
| `~/.robota/mcp-credentials/`                | OAuth tokens for remote servers, owner-only.             |

### Security model

- **Definitions grant nothing by themselves.** A server is used only after your approval, and the
  approval covers the exact definition: changing what it runs or where it connects makes it `stale`,
  while rotating a credential it reads from the environment does not. Project and local definitions
  also need a trusted workspace and cannot approve themselves.
- **Running a local program needs host authority.** A stdio definition cannot give itself the right
  to spawn a process; a header helper runs only when its exact command line is in your user
  settings, and a project's helper runs without your credential-shaped environment variables.
- **Remote URLs are checked before any connection.** Loopback, private-network, link-local and
  cloud-metadata addresses are refused, and redirects are not followed, so definition headers never
  reach a host that was not admitted.
- **OAuth trusts only what it checked.** The server's resource metadata must name the server, the
  authorization server's metadata must name its issuer, every endpoint must be `https`, and PKCE
  `S256` must be offered — otherwise sign-in refuses. Tokens are stored per server identity and URL,
  so another definition under the same name cannot use them, and refreshes go only to where the
  tokens came from.
- **Secrets are not printed.** `/mcp` and every error show header and environment names but never
  their values, and mask the parts of commands and URLs that came from credential-shaped variables.
- **A server authenticates the way it declared, or not at all.** A server that asks for
  authentication the CLI cannot provide stays listed and is refused by name; it is never connected
  with its static headers alone.
- **The loopback bearer never leaves the machine.** It is written only to the token file, never to
  argv, stdout or a URL; a non-loopback bind is possible only as an OAuth resource server.

### Limitations

- A remote server on `localhost` or a private network address is refused by the CLI's default
  address policy.
- `robota mcp serve` in remote mode serves one session shared by every admitted subject.
- There is no in-session way to use a pre-registered client's secret; use
  `robota mcp login <name> --client-secret` in a terminal.

### Troubleshooting

| Message or symptom                                                                        | Fix                                                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ``MCP definition "<name>" … was refused: no `type` …``                                    | Add `"type": "http"` (or `"stdio"`) to the entry.                                                   |
| `MCP server "<name>" was not admitted (pending)`                                          | Run `/mcp approve <name>`, then `/mcp login <name>` for an OAuth server.                            |
| `MCP server "<name>" was not admitted (untrusted)`                                        | The definition is in project settings; run `robota trust --yes`.                                    |
| `MCP server "<name>" stdio was refused: missing host authority.`                          | The CLI does not start stdio servers from settings (see above).                                     |
| `Signed in to MCP server <name>, but it is not approved for this session`                 | Run `/mcp approve <name>`, then `/mcp login <name>` again.                                          |
| `Sign-in … failed (browser-failed)`                                                       | Use `/mcp login <name> --no-browser`.                                                               |
| `A client secret is never typed into a session.`                                          | Run `robota mcp login <name> --client-secret` in a terminal.                                        |
| `"mcpHeaderHelpers" in <file> was ignored: only user settings may allow a header helper.` | Move the list to `~/.robota/settings.json` or `~/.claude/settings.json`.                            |
| `Remote authorization requires … together`                                                | Pass all of `--http-public-url`, `--oauth-issuer`, `--oauth-scopes` and `--oauth-allowed-subjects`. |

## Related

- [CLI reference](./cli.md)
- [Permissions and hooks](./permissions-and-hooks.md) — rule syntax for `<server>__*` tool names
- [Sessions, background sessions and the daemon](./sessions-and-daemon.md) — workspace trust and background sessions
- [Devices and remote control](./devices-and-remote.md)
- [`@robota-sdk/agent-mcp`](../../packages/agent-mcp/docs/README.md) and its [SPEC](../../packages/agent-mcp/docs/SPEC.md) — the MCP client
- [`@robota-sdk/agent-transport-mcp`](../../packages/agent-transport-mcp/docs/README.md) and its [SPEC](../../packages/agent-transport-mcp/docs/SPEC.md) — the MCP server transport
- [`@robota-sdk/agent-cli` SPEC](../../packages/agent-cli/docs/SPEC.md) — the CLI's MCP composition and its current limitation
