# @robota-sdk/agent-mcp

The Model Context Protocol (MCP) client for the Robota SDK: everything needed to let an agent use tools
from external MCP servers. It keeps three concerns separate:

- **Definitions** — what an MCP server is: decoding configuration entries, environment templates,
  precedence between configuration sources, disable overlays, redacted projections for display, and the
  identity and fingerprint an approval is tied to. Pure; nothing here connects or spawns.
- **Activation** — whether a definition may be used: a deny-by-default admission port, exact identity
  matching, and a replaceable approval and audit store. The host decides workspace trust.
- **Client, catalog and supervision** — the official `@modelcontextprotocol/client`, one client for both
  protocol eras, behind an admit-then-construct transport seam, the canonical catalog of discovered
  tools, prompts and resources, and a supervisor for the connection and catalog lifecycle.

The main entry is platform-neutral: it runs in a browser, a Web Worker, Node, Deno and Bun and never
reaches a file, a process or a socket. What needs a Node host — the stdio transport and the authority that
admits a child process, the owner-only OAuth credential files and refresh lock, the loopback listener a
sign-in redirects to, and the Node pieces of the HTTP transport — is on `@robota-sdk/agent-mcp/node`, and
the main entry takes each of them by injection.

Transports are Streamable HTTP and host-authorized stdio. Discovered tools enter the agent through the
ordinary tool slot, so there is no MCP-specific runtime path. The agent runtime CLI uses this package for its
`mcpServers` configuration; see the [MCP guide](../../content/guide/mcp.md) for that side. To expose a
agent session _as_ an MCP server, use
[`@robota-sdk/agent-transport-mcp`](../agent-transport-mcp/README.md).

Tool results retain ordered resource links, embedded text or binary resources, and inline audio
alongside structured state, including failed observations. Resource URIs remain opaque references;
receiving a link never fetches or activates it. Adapters without native resource/audio support project
resource text and explicit binary/audio limitations into the linked tool response. Binary bytes remain
in the typed receipt and persisted session; these text projections do not claim native audio delivery.
The complete result envelope counts toward the host's admission bound and is preserved when spilled.

## Explicit stateless wire surface

SDK hosts can pass `protocolVersion: '2026-07-28'` to `openMcpSession` after normal transport admission.
A server definition can also select this path with `protocolVersion: '2026-07-28'` on HTTP or stdio.
Omitting it preserves the legacy handshake. Protocol changes invalidate existing activation approvals;
management projections retain the selected version. Unsupported versions or carriers are refused by name. The selected path sends `server/discover` and includes
protocol version, client identity and empty optional client capabilities in every request. The HTTP
header matches the body; an unsolicited legacy session header is never inherited. Selection cannot
grant process/network authority or fall back to replay a mutation on another protocol.

The wire contract is pinned to the [official schema at revision
046fa30](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/046fa30efd374370afb87ef830bd788eac5f217e/schema/2026-07-28/schema.ts).
One `@modelcontextprotocol/client` serves both eras. This path pins it to `2026-07-28`: a server that
does not offer that revision is refused by name and never retried over the legacy handshake, while
omitting the version negotiates the legacy era. A result without its `resultType` is refused rather than
assumed complete. An invalid freshness hint on `server/discover` is read as the safest one (`ttlMs` 0,
`cacheScope` private) instead of rejecting the server; a list page or resource read with one is refused.

Discovery validates and exposes each page's `ttlMs`, `cacheScope` and host receive time, and exposes
the server discovery hint as the client read it. These values are freshness hints, not integrity or authority. Retained catalog
identity includes a fresh carrier generation, preventing private data reuse across reconnects.
If optional server information is absent, the configured server ID labels the source and the version
is empty with `serverInfoProvided: false`; no external revision is invented.

This initial SDK surface supports declared tools, prompts and resources discovery plus completed
tool calls. A host that opens the session with `elicitation: true` lets a server's form-mode
elicitation during a tool call reach a person as ask prompts through that call's `ask` port, titled
with the configured server id; the answer continues the same call, and the prompt is withdrawn when
the call ends (when the last in-flight call to that server ends, if there are several). Otherwise `compatibilityDiagnostics` names the unavailable MRTR client input, as it
does subscription watches and unselected optional extensions. Unsupported result types close the
carrier and require operation inspection; so does an embedded request this surface does not answer
(sampling, roots, more rounds than the client allows), while an embedded elicitation the client
refuses on its face (URL mode, a malformed form) fails the call with the carrier open; none ever
becomes a successful tool observation or causes automatic replay. A deadline or abort also closes
uncertain execution. Hosts must refresh lists explicitly; this does not implement automatic
TTL-based catalog refresh. Reading a generic resource cannot activate a skill.

### Opt-in Skills wire view

SDK hosts can additionally pass `skills: true` to `openMcpSession`. This requires the explicitly
selected stateless protocol and the server's valid Skills extension and Resources capability.
`session.skills` is otherwise absent, with a compatibility diagnostic when requested but unavailable.
The [Skills extension](https://skills.extensions.modelcontextprotocol.io/specification/stable/skills)
defines the metadata and complete file manifests used here.

`skills.list({ maxPages })` reads metadata only; `skills.get(uri)` confirms an explicitly referenced
skill even after an empty listing. Entries retain the server identity, carrier generation, complete
frontmatter and content fingerprint. `skills.read(entry, fileUri)` lazily verifies the requested
file's raw byte size and SHA-256 before returning it. Refreshes invalidate old manifests; malformed or
changed bytes require a fresh manifest. Dynamic manifests are exposed but verified reads are refused.
The host's opt-in enables bounded file responses supporting 512 files and a 16 MiB raw manifest,
including JSON/base64 framing; ordinary metadata and tool responses retain their existing receive limit.

This SDK view grants no instruction activation or tool permissions. A host must separately compare
the loaded YAML frontmatter with the advertised metadata, require explicit content-bound user consent,
preserve server-plus-URI identity in registry/approvals/caches, and revoke consent when content changes.
Nested `SKILL.md` files are supporting bytes until separately approved. CLI/app skill activation and
optional directory reads are not provided by this wire view.

## Installation

```bash
npm install @robota-sdk/agent-mcp @robota-sdk/agent-core
```

Requires Node.js 22.12 or later for the `@robota-sdk/agent-mcp/node` adapters.
`@robota-sdk/agent-core` is a peer dependency.

## Usage

Admit a transport, open a session inside a connection supervisor, discover the server, build the
catalog, and turn each discovered tool into a runtime tool:

```ts
import {
  createStreamableHttpAdapter,
  openMcpSession,
  MCPConnectionSupervisor,
  buildCatalog,
  createDiscoveredTool,
} from '@robota-sdk/agent-mcp';
import { createNodeHttpTransportDeps } from '@robota-sdk/agent-mcp/node';

// On Node: the egress that refuses private destinations and pins the connection, and the call context.
const adapter = createStreamableHttpAdapter(createNodeHttpTransportDeps());
const admission = await adapter.admit({ url: 'https://example.com/mcp' });
if (!admission.ok) {
  throw new Error(`${admission.reason}: ${admission.message}`);
}

const timeouts = {
  startupMs: 10_000,
  perCallMs: 30_000,
  globalDefaultMs: 30_000,
  idleMs: 60_000,
  toolCallMs: 30_000,
};
const serverId = 'example';

const supervisor = new MCPConnectionSupervisor({
  serverId,
  openSession: (signal) =>
    openMcpSession({
      serverId,
      transport: adapter.construct(admission.admitted),
      timeouts,
      signal,
    }),
  timeouts,
});

const discovery = await supervisor.discover();
const catalog = buildCatalog([
  { serverId, origin: 'config:example', transport: 'streamable-http', discovery },
]);

const tools = catalog.adopted
  .filter((entry) => entry.kind === 'tool')
  .map((entry) => createDiscoveredTool(entry, supervisor));
```

The Node egress validates and pins each actual request, including authentication retries and SSE
reconnects, to addresses from the resolver captured during admission. Closing a transport withdraws
pending requests and late authentication results and releases its owned connections. A `fetch` passed
to `createNodeHttpEgress` is an owner/test carrier with its own socket-policy responsibility; every
request is still judged first.

From a repository checkout, build core and this package, then use
[`examples/verify-http-transport.mjs`](examples/verify-http-transport.mjs) to exercise initialization,
an actual persistent SSE connection and cleanup in Node or Bun against a separate disposable Node server:

```sh
pnpm --filter @robota-sdk/agent-core build
pnpm --filter @robota-sdk/agent-mcp build
node packages/agent-mcp/examples/verify-http-transport.mjs
mcp_fixture_node=$(node -p process.execPath)
bun packages/agent-mcp/examples/verify-http-transport.mjs "$mcp_fixture_node"
mcp_fixture_dir=$(mktemp -d)
bun build --compile --minify packages/agent-mcp/examples/verify-http-transport.mjs --outfile "$mcp_fixture_dir/mcp-smoke"
"$mcp_fixture_dir/mcp-smoke" "$mcp_fixture_node"
rm -rf "$mcp_fixture_dir"
```

The fixture explicitly permits its disposable local server; it does not verify a full CLI worker,
cloud provider or physical egress containment. The HTTP socket, authentication, trace and receive
limit suites cover their corresponding contracts separately.

`admit` asks the host's egress before any connection. The Node egress refuses a loopback or
cloud-metadata host, and any name that resolves to a private address range; the transport itself refuses
redirects rather than following them. `openMcpSession()` identifies itself to the server as `mcp-client`
unless you pass `clientInfo`.

### What the host supplies

The HTTP transport reads nothing from the machine it runs on. The composition root passes, in the
`createStreamableHttpAdapter(deps)` or `admitHttpEndpoint(endpoint, deps)` argument:

| Option        | Without it                                                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `egress`      | Web `fetch` with no destination check beyond `http:`/`https:` (`createWebFetchEgress()`): nothing resolves a name or refuses a private address, so a host outside a browser's sandbox must pass one. `createNodeHttpEgress` is it |
| `callContext` | No `traceparent` is sent, and the transport does not abort the request of a cancelled call (the SDK still rejects the call); `createNodeCallContext` carries the call through `AsyncLocalStorage`                              |

`createNodeHttpTransportDeps(options)` on `/node` returns both, and is what the CLI composition passes
for every HTTP server. OAuth takes its network (`IMCPOAuthNetwork`; `createNodeOAuthNetwork` on `/node`)
as a required input, and its loopback listener (`callbackListener`; `loopbackOAuthCallbackListener` on
`/node`) as an optional one: without a listener, a sign-in that needs one fails with
`callback-unavailable` before anything is shown to the user.

The catalog sorts everything the server disclosed into `adopted`, `adapted` and `rejected` entries, with
stable, collision-safe tool names. The supervisor retries only transient failures, with bounded backoff,
and keeps a catalog marked stale rather than emptying it when a refresh fails.

### stdio

Stdio is on `@robota-sdk/agent-mcp/node`: a host that composes without it has no stdio transport to
construct and connects no stdio server. It needs a host-owned `IMCPStdioAuthority`: an allowed root directory, an absolute executable, exact
argument vectors, an explicitly selected child environment, and a generation. Pass a resolved definition
and its activation request to `createStdioAdapter({ admission, authority }).admit(...)` (from
`@robota-sdk/agent-mcp/node`) before opening a
session; the adapter rechecks activation and authority before every spawn. The child inherits no ambient
environment values: the SDK's default environment keys are present only with host-selected values or
empty strings. Cancelling or timing out an active stdio request closes the direct child, because the
SDK provides no cancellation acknowledgment; grandchild processes are outside this transport's
guarantee. See the runnable [`--allowed` / `--denied` example](examples/verify-stdio-transport.ts).

### Authentication

A host registers an authenticator for one server identity, and the HTTP transport asks it for headers on
every request to that server only. The package provides:

- OAuth sign-in for servers that declare `oauth`: `runMCPOAuthLogin`, `runMCPOAuthLogout`,
  `createOAuthAuthenticator`, with storage (`IMCPOAuthCredentialStore`; `createFileOAuthCredentialStore`
  on `/node`) and a cross-process refresh lock (`IMCPOAuthRefreshLock`; `createFileOAuthRefreshLock` on
  `/node`) as replaceable ports.
- A headers helper (`createHeadersHelperAuthenticator`): an exact argv the host allows and runs, whose
  output is parsed strictly into request headers.

A definition that asks for authentication the host cannot provide stays listed and is refused by name;
it is never connected with its static headers alone.

## Node adapters

`@robota-sdk/agent-mcp/node` holds what only a Node host provides:

| Export                                                         | Kind     | Description                                                                                  |
| -------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `createStdioAdapter`                                           | Function | Admits and spawns a host-authorized stdio server (with the `IMCPStdio*` types)               |
| `createNodeHttpEgress`, `INodeHttpEgressOptions`               | Function | The HTTP egress: resolved-address policy, pinned connection, owner/test `fetch`              |
| `createNodeCallContext`                                        | Function | The `AsyncLocalStorage` call context that ties a tool call to its own request                |
| `createNodeHttpTransportDeps`                                  | Function | Both of the above as the transport's deps                                                    |
| `createNodeOAuthNetwork`, `INodeOAuthNetworkOptions`           | Function | The OAuth network: egress policy, byte caps, no redirect on a POST                           |
| `createFileOAuthCredentialStore`                               | Function | Owner-only credential files, one per server identity and URL                                 |
| `createFileOAuthRefreshLock`, `IFileOAuthRefreshLockOptions`   | Function | One refresh at a time per credential, across processes                                       |
| `loopbackOAuthCallbackListener`, `startOAuthCallbackServer`, `freeLoopbackPort` | Value, functions | The loopback listener a sign-in redirects to |

## Where it sits

Depends only on `@robota-sdk/agent-core` (peer) and the MCP client packages
(`@modelcontextprotocol/client` and `@modelcontextprotocol/core`). It owns no tool registry and no
product identity: the composition root (for example the CLI) chooses the client identity and wires the
discovered tools in.

## Documentation

- [docs/SPEC.md](docs/SPEC.md) — the full contract: admission, precedence, secrecy, OAuth, stdio
  authority and supervision.
- [docs/README.md](docs/README.md) — documentation index.
