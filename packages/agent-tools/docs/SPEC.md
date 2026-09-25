# Tools Specification

## Purpose

Owns the tool factory constructors, tool result types, sandbox execution ports, and sandbox
workspace manifest contracts for the Robota SDK: ergonomic tool-construction factories that build
`@robota-sdk/agent-core`'s `FunctionTool`, plus a set of built-in CLI tools (shell, bash, read,
write, edit, glob, grep, web-fetch, web-search, ask-user-question) used by the agent CLI.

## Boundaries

- Does not own the abstract tool base class or tool interface contracts — those belong to
  `@robota-sdk/agent-core`; this package's factories construct core's `FunctionTool`.
- Does not own permission evaluation or hook execution — tool permission wrapping is performed by
  consumers (e.g. `@robota-sdk/agent-session`).
- Does not own the MCP tool protocol — MCP definitions and tools live in `@robota-sdk/agent-mcp`.
- Provider-agnostic: no provider-specific behavior, and no required provider SDK — provider
  sandbox adapters are structural adapters an application opts into.
- Does not own CLI manifest file parsing — YAML/JSON parsing belongs to the CLI composition layer
  and must converge into this package's workspace manifest contract.
- The browser entry point is a deliberately separate, minimal import graph that excludes every
  Node-only builtin by construction, so the browser build cannot pull in `node:`-only code even
  transitively.

## Contract

### Built-in tool factories, not shared instances

Built-in tools are exposed only as factories, never as ready-made module-level instances. A
module-level instance would be bound at import time with no containment root, so importing one
could produce a file tool with no path boundary (e.g. a `Read` that could return any host file).
The `cwd` each factory takes is required, so this cannot recur by omission, and construction
refuses rather than silently allows if it somehow does.

### Shell trace context

The foreground shell tool hands its child the call's `TRACEPARENT` only when the call's context
carries one, in a fresh copy of the environment with the ambient `TRACESTATE` removed; the process's
own environment is never modified, so no other child can pick the value up. Without it the child
sees exactly the ambient environment. A sandboxed run receives nothing, since the value would leave
the host.

### Path resolution

`Read`, `Write`, and `Edit` declare `filePath` as absolute, but a relative path from the model is
resolved against the tool's own containment root (its `cwd`), never against the process's current
directory, before the containment check and the filesystem call — the same anchoring applies to
`Glob`/`Grep`'s search root. The permission gate is not owned by this package, but the consumer
wrapping the tool must canonicalize the same argument the same way before the gate sees it, so the
path judged is the path opened.

### Write/Edit semantics

- `Write`'s reported byte count is the actual UTF-8 byte length, not the JS string length, which
  differs for multibyte content.
- `Write` and `Edit` replace file content by writing to a temporary file in the same directory and
  renaming it into place; when replacing an existing target, the temp file is given the target's
  existing mode bits first so permission-sensitive files (e.g. executable scripts) keep their
  permissions, and the temp file is cleaned up after a failed write when possible. This keeps
  built-in filesystem mutations provider-agnostic while preventing partially-written targets
  during automated edit/build/verify loops.

### AskUserQuestion

Consumes an injected ask port; a dismissed question cancels the remaining unasked ones in the same
call. Without an ask port (headless), the tool returns a structured "unavailable" result — never a
silent guess and never a thrown error.

### Tool descriptions are a model-facing contract

Built-in tool descriptions are injected verbatim into the consuming agent's context, so they are
governed, not incidental:

- Default text states mechanism only — what the tool does and how its parameters behave — and must
  not carry product- or workflow-specific policy; that belongs to the consuming product's prompt
  layer.
- A default description may reference a sibling tool only by a name this package actually ships,
  and only in a way a differently-assembled tool registry can correct (routing hints are derived
  from the actual registered tool set, not hardcoded).
- A description must not assert a contract the runtime does not enforce.
- Every built-in factory accepts a description override that replaces the default text verbatim,
  so a consumer can supply deployment-specific guidance at its own composition root.

### Deferred tool search

A dedicated always-resident tool loads the schemas of tools withheld under deferred-loading policy;
matches become resident for the rest of the session. Its argument accepts either a free-text query
(matched against name, description, and parameter name/description) or an exact list of names, and
a call supplying neither is refused rather than guessed at. Matching is deterministic and ranked
(exact name, then name, then description, then parameter matches, tie-broken by name), so a given
catalog and query always return the same tools in the same order. An empty match is a normal
result; an unknown name in an explicit list is an error naming the offending entry — the two are
deliberately not the same outcome. The tool itself refuses to run if the runtime has not wired a
deferred-tools catalog into it, rather than silently reporting an empty result for a search that
never happened.

### Extension points

- `createFunctionTool` / `createZodFunctionTool` build custom tools from a plain schema or a Zod
  schema; a Zod object schema marked `passthrough()` is converted so core's validation accepts
  unknown root parameters.
- `ISandboxClient` lets a consumer inject a provider-backed execution plane into sandbox-aware
  built-ins; its optional snapshot/restore methods return and hydrate provider-owned resumable
  workspace references. When no sandbox client is supplied, tools fall back to host-local
  execution. A client declares whether its filesystem is shared with the host (commands confined
  over the host's files) or separate (a remote or VM filesystem), because that decides where file
  tools may look: on a separate filesystem every file tool goes through the sandbox and the
  host-only enumerators are withheld, so a search can never read one filesystem while an edit
  writes another. Containment sits below the permission gate — deny and ask rules are decided
  before a tool body chooses the host or the sandbox — and the execution root is the file tools'
  containment boundary but only the shell's default directory, never a boundary for commands. A
  shared client that confines a host process in place only rewrites the invocation, so the shell
  tool keeps its own timeouts, cancellation, output limits and process-group kill.
- The OS sandbox promises only what the OS enforces. Its network boundary is on or off, and off
  closes Unix sockets too, because a per-domain allowlist needs a proxy the OS does not enforce and
  a host daemon's socket is a way out; the model cannot ask to leave it. What it guards is outside
  the workspace plus the workspace's own trust inputs — the repository's `.git` whole (the files in
  it that make git run something are too many to list and keep complete) and the agent, MCP and
  shell configuration at the root: read-only where they exist, moved out of the workspace when the
  command that created one ends where they did not (a mount cannot protect a path that does not
  exist yet, so it is live on the host for that long; moving loses nothing the host wrote
  meanwhile), and never auto-approved while one is a symlink the
  command could redirect. Everything else in the workspace is the command's to change, as it is the
  file tools'; a nested repository or build script it writes is workspace content, and the sandbox
  does not make running host tools over it safe.
- `IWorkspaceManifest` / its applicator declare fresh-session sandbox contents (inline/local files,
  directories, Git clones) through `ISandboxClient`; provider-specific storage mounts are
  represented in the contract but report an explicit "unsupported" status until an adapter
  supplies native mount capability, rather than failing silently or faking success.
- `IWebSearchProvider` is a duck-typed port; the default adapter is the only module holding a
  vendor endpoint, so the tool layer itself carries no vendor URL literal and provider failures
  surface as structured tool-result errors rather than being swallowed.

## Error handling

Built-in tools report ordinary input, network, and path failures through their result envelope.
Grep executes pattern matching outside the caller's event loop; exhaustion, worker failure, and
cancellation are hard execution errors surfaced only after the isolated operation has stopped.
Read admits host file bytes independent of the requested line slice and bounds formatted output;
budget exhaustion and cancellation are hard errors, while missing and binary files remain ordinary
tool results. Edit admits file content under the same per-operation ceiling as Read/Grep before
running its string operations, and rejects a replacement whose output would exceed it, but reports
either as an ordinary failed tool result rather than a thrown error, consistent with the rest of
Edit's error handling.
