# Tool Node Specification

## Purpose

Owns the `tool` DAG node, which wraps a single **in-process** `@robota-sdk/agent-tools` builtin (Read,
Write, Edit, Shell, Bash, Glob, Grep, WebFetch, WebSearch) as one DAG step, emitting its text output.

Distinct from the `mcp-tool` node: `mcp-tool` calls an **external** MCP server over HTTP/stdio; this
node runs an agent builtin in the current process — no network transport, no MCP client.

## Contract

- Tool selection is a static allowlist (`toolName` → agent-tools factory). Only the enumerated
  builtins are constructible; an unknown `toolName` yields a validation error listing the allowed
  names.
- `config.params` supplies static tool arguments; a JSON `params` input port is merged over them
  (input wins).
- Result mapping: a thrown `ValidationError`/`ToolExecutionError` becomes `ok: false`; a JSON-encoded
  `IToolInvocationResult` with `success: false` (a soft, tool-reported failure, e.g. a binary file)
  becomes `ok: true` with `isError: true` and the error text as output; otherwise `ok: true` with the
  tool's text output and `isError: false`.

## Invariants — containment (SEC-007)

- Every builtin is constructed per invocation and bound to a containment root; none is taken from
  `agent-tools`' module-level singletons, which are context-free by construction and therefore
  uncontained.
- The root is the trusted, canonical, absolute `INodeExecutionContext.executionRoot`; the node never
  reads `process.cwd()`.
- `config.cwd` may only **narrow** that root — it arrives in the same LLM-authorable `.dag.json` as
  the paths it would be containing, so it cannot be trusted to widen it. A `cwd` resolving outside the
  execution root, including via `..` or an escaping symlink, fails the node.
- Containment is decided on canonical (symlink-resolved) paths, so an escape via a symlink is refused
  too, not just a lexical `..`.
- For `read`/`write`/`edit`/`glob`/`grep` the root is a real boundary: an out-of-root path or search
  root is refused, and no entry whose canonical path escapes is enumerated or disclosed.
- For `shell`/`bash` the root is the default working directory and **deliberately not a boundary** — a
  cwd guard on arbitrary command execution is undone by the first `cd ..`, so enforcing it there would
  constrain nothing while reading as a boundary in review. The real boundary for command execution is
  the permission layer and the sandbox seam.
- `web-fetch`/`web-search` have no filesystem path and ignore the root.

## Non-goals

- The DAG subsystem itself stays `private`; this package is `private: true`. It is not a general
  agent-tools re-export — only the enumerated allowlist is reachable through it.
