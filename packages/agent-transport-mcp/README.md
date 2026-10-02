# @robota-sdk/agent-transport-mcp

Model Context Protocol (MCP) server transport for the Robota SDK. It exposes a running agent session as
an MCP server, so MCP-aware clients (desktop assistants, IDE integrations, other agents) can call the
session's tools and submit prompts to it. The same session can be served three ways:

| Carrier                   | Factory                   | Who can reach it                                                    |
| ------------------------- | ------------------------- | ------------------------------------------------------------------- |
| stdio                     | `createMcpTransport`      | The process that launched this one (it owns stdin/stdout)           |
| Streamable HTTP, loopback | `createMcpHttpHost`       | Local clients holding the bearer token minted for this host         |
| Streamable HTTP, remote   | `createMcpRemoteHttpHost` | Clients presenting an OAuth access token that your verifier accepts |

This package is the MCP _server_ side. To connect an agent to other MCP servers as a client, use
[`@robota-sdk/agent-mcp`](../agent-mcp/README.md). The agent runtime CLI serves a session this way with
the configured CLI's `mcp serve` command; see the [MCP guide](../../content/guide/mcp.md).

## Installation

```bash
npm install @robota-sdk/agent-transport-mcp
```

Requires Node.js 22.12 or later. The MCP SDK packages are regular dependencies. For the remote host,
also install `@robota-sdk/agent-transport` to build the access-token verifier.

## What the server exposes

- **The session's runtime tools**, under their canonical names, descriptions and input schemas. Calls
  go through the session's permission wrapper without interactive approval prompts: a call that would
  need one fails as a visible tool error, as do unknown names, denial, a busy session and cancellation.
  Results are serialized execution envelopes; failures set `isError`.
- **A submission tool**, `agent_submit` by default, that takes `{ prompt: string }` and returns the
  agent's turn response. Pass `submitTool: { name, description }` to any of the factories to name it
  differently; a runtime tool with the same name fails startup.
- Prompts and resources are not advertised. Cancelling a request cancels only that invocation.

## stdio

```typescript
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';
import type { IMcpTransportSession } from '@robota-sdk/agent-transport-mcp';

declare const session: IMcpTransportSession; // e.g. an InteractiveSession from @robota-sdk/agent-framework

const transport = createMcpTransport({ name: 'my-agent', version: '1.0.0' });
transport.attach(session);
await transport.start(); // validates the tool catalog, then serves on process stdin/stdout
await transport.waitForClose(); // settles when the client closes the stream
await transport.stop();
```

Pass `stdin` / `stdout` to use streams other than the process's own. To connect the server to a carrier
of your choice instead, `createAgentMcpServer({ name, version, session })` returns the configured MCP
SDK `Server` after validating the catalog.

## Streamable HTTP on loopback

```typescript
import { createMcpHttpHost } from '@robota-sdk/agent-transport-mcp';
import type { IMcpTransportSession } from '@robota-sdk/agent-transport-mcp';

declare const session: IMcpTransportSession;

const host = createMcpHttpHost({ name: 'my-agent', version: '1.0.0', session });
const { url, token } = await host.start(); // url is http://127.0.0.1:<port>/mcp
// Give `token` to the client, which sends it as `Authorization: Bearer <token>`.
```

The host binds `127.0.0.1` only (a `host` option other than `127.0.0.1` throws) and picks a free port
unless you pass `port`. A request with the wrong path, `Host` or `Origin` is refused with `403`, and one
without the bearer token with `401`, before its body is read. The token is a fresh 256-bit value for each
host and is returned only to the caller: keep it out of command lines, logs, URLs and world-readable
files.

## Streamable HTTP for remote clients (OAuth)

The remote host is an OAuth protected resource. It has no open mode and never accepts the loopback
token: every request needs an access token issued by your authorization server, checked by a verifier
you supply. `createAccessTokenVerifier` from `@robota-sdk/agent-transport/node` builds one that
validates JWT access tokens against the issuer's published keys.

```typescript
import { createAccessTokenVerifier } from '@robota-sdk/agent-transport/node';
import { createMcpRemoteHttpHost } from '@robota-sdk/agent-transport-mcp';
import type { IMcpTransportSession } from '@robota-sdk/agent-transport-mcp';

declare const session: IMcpTransportSession;

const publicUrl = 'https://agent.example.com/mcp';
const issuer = 'https://auth.example.com';
const scopes = ['agent'];

const host = createMcpRemoteHttpHost({
  name: 'my-agent',
  version: '1.0.0',
  session,
  port: 8443,
  authorization: {
    publicUrl,
    issuer,
    scopes,
    verifier: createAccessTokenVerifier({
      issuer,
      resource: publicUrl,
      algorithms: ['RS256'],
      requiredScopes: scopes,
      allowedSubjects: ['user-id-at-the-issuer'],
    }),
    audit: (record) => console.warn('MCP refused', record.refusal, record.remote),
  },
});

const { listening, url } = await host.start();
```

- `publicUrl` is the `https` URL clients use. It is also the token audience, and the endpoint path,
  `Host` and `Origin` checks come from it, so a proxy in front must forward the path unchanged and keep
  the `Host` header.
- The host binds `127.0.0.1` by default (for a TLS-terminating proxy on the same machine); pass `host`
  with a literal IP address to bind elsewhere. `X-Forwarded-For` is honoured only from
  `trustedProxies`.
- It serves the OAuth protected-resource metadata document so clients can discover the issuer and
  scopes. Refusals carry only the standard `WWW-Authenticate` challenge. Repeated failures from one
  address are throttled with `429`; valid tokens are never throttled.
- `audit` receives one record per refused request: a reason and a coarse address class, never the token
  or the address.
- Construction throws when `publicUrl` or `issuer` is not `https` or `scopes` is empty. The verifier
  likewise refuses to build without at least one `allowedSubjects` or `allowedClients` entry, so a
  token the issuer minted for someone else is not enough.

## Lifecycle

`createMcpTransport` follows the standard transport lifecycle: `start()` resolves once the server can
answer requests (bounded to 15 seconds and cancellable by `stop()`), starting before `attach()` or twice
rejects, `stop()` is safe to repeat, and a restart needs a new `attach()`. The HTTP hosts take the session
at construction; `start()` validates the catalog and binds, and `stop()` / `waitForClose()` end and
observe the listener. Both HTTP hosts are stateless: there is no MCP session id to guess or resume.

## Exports

| Symbol                                                                 | Kind      | Description                                                                                                    |
| ---------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `createMcpTransport`                                                   | function  | `(options: IMcpTransportOptions) => IMcpTransport` (stdio)                                                     |
| `createAgentMcpServer`                                                 | function  | `(options: IAgentMcpOptions) => Promise<Server>`                                                               |
| `createMcpHttpHost`                                                    | function  | `(options: IMcpHttpHostOptions) => IMcpHttpHost` (loopback, bearer)                                            |
| `createMcpRemoteHttpHost`                                              | function  | `(options: IMcpRemoteHttpHostOptions) => IMcpRemoteHttpHost` (OAuth)                                           |
| `IMcpTransportOptions`, `IMcpTransport`                                | interface | `{ name, version, stdin?, stdout?, submitTool? }`; adds `getServer()` and `waitForClose()`                     |
| `IAgentMcpOptions`                                                     | interface | `{ name, version, session, submitTool? }`                                                                      |
| `IMcpHttpHostOptions`, `IMcpHttpHost`                                  | interface | `{ name, version, session, port?, host?, submitTool? }`; `start()` returns `{ url, token }`                    |
| `IMcpRemoteHttpHostOptions`, `IMcpRemoteHttpHost`                      | interface | `{ name, version, session, authorization, host?, port?, submitTool? }`; `start()` returns `{ listening, url }` |
| `IMcpRemoteAuthorization`                                              | interface | `{ publicUrl, issuer, scopes, verifier, trustedProxies?, audit? }`                                             |
| `IMcpRemoteAuditRecord`, `TMcpRemoteRefusal`, `TMcpRemoteAddressClass` | type      | The audit record and its fields                                                                                |
| `IMcpSubmitToolIdentity`                                               | interface | `{ name, description }` of the submission tool                                                                 |
| `IMcpTransportSession`                                                 | interface | The session capabilities used: turn submission and runtime tools                                               |

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
