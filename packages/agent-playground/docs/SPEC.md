# Playground Specification

## Purpose

Owns the Robota Playground UI package: interactive agent experimentation in the browser, executed
against a remote agent server rather than a local session stack.

## Boundaries

- Does not own core agent contracts — imports them from `@robota-sdk/agent-core`.
- Does not own remote transport contracts — imports `RemoteExecutor` from
  `@robota-sdk/agent-remote-client`.
- Does not own WebSocket transport hosting; playground WebSocket message types are local UI
  contracts, not a shared transport definition.
- Does not define deployment or hosting behavior; that belongs to the hosting app.

## Design decision: no agent-framework session stack

The playground intentionally does not depend on `@robota-sdk/agent-framework`,
`@robota-sdk/agent-session`, or `@robota-sdk/agent-executor`. This is a deliberate lightweight
client design, not architectural drift.

**Rationale**: the playground is a browser UI that delegates agent execution to a remote agent
server via `@robota-sdk/agent-remote-client`. Session management, conversation persistence,
compaction, permission enforcement, context loading, and command APIs all run on the server side;
the playground renders results without running a local session stack. If the playground needs to
support local (offline) execution in the future, that requires a dedicated backlog item and
explicit architectural review — it is not something to slide into incrementally.

**Dependency boundary**: `@robota-sdk/agent-core` (type contracts), `@robota-sdk/agent-remote-client`
(remote execution), and `@robota-sdk/agent-tools` (built-in tool factories) are allowed.
`@robota-sdk/agent-framework`, `@robota-sdk/agent-session`, and `@robota-sdk/agent-executor` are
not. Generated code (editor templates, the remote-injection import rewriter) may emit and rewrite
provider import-path strings as text without linking a provider package.

## Contract

- Browser consumers that only render the React playground must import from the package's
  `/client` browser-safe entry; the root entry also exports service-layer APIs for
  server/runtime consumers and must not be used as the browser page entry.
- Errors surface through a UI error classification with three kinds: `user_message` (validation,
  invalid input, unknown tool), `fatal` (strict-policy violations, path-only failures, no-fallback
  violations), and `recoverable` (the default for transient/system errors).

## Extension points

- Consumers can implement custom tools (name, description, schema, execute) and custom plugins
  (initialize/dispose lifecycle) against the playground's tool and plugin contracts.
