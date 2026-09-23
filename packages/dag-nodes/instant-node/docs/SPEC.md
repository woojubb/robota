# SPEC: @robota-sdk/dag-node-instant-node

## Purpose

Enables AI agents to create custom DAG node types at runtime without writing TypeScript or
restarting any process. Phase A delivers **Prompt-Backed Instant Nodes**: nodes whose execution
behavior is defined by a system prompt template applied to input port values. A composite variant
wraps an inner DAG behind exposed input/output ports.

## Persistence contract

Each instant-node definition exposes the serializable data needed to reload it via
`toPersisted()`. This lets a persistence layer serialize a node from its `IDagNodeDefinition`
alone and reconstruct it later — a composite's `runner` is behavioral and is **rebuilt on
reload**, never serialized.

This package owns both halves of the round-trip: a runtime guard for persistable nodes, a
validating parse from an untrusted manifest that never throws, and a rehydration step that
recreates the typed definition. Rehydrating a composite record without an injected runner throws
— never a half-built node. Consumers parse and rehydrate through this package rather than
hand-rolling deserialization.

## Composite execution lineage

Every composite invocation carries an execution lineage naming the root run, the immediate parent
run, the child DAG depth, the tightest inherited depth ceiling, and the ordered ancestor composite
node types. Runners must forward this lineage into every child node's execution context; a new
child run cannot reset the depth by constructing a fresh runner.

Before launching a child run, the composite rejects a child DAG that contains its own node type or
any ancestor composite node type, and rejects launches beyond `maxDepth` (default and hard maximum:
three nested DAG boundaries; zero disables child launches). This is a runtime guard, not a
constructor-time guess — direct and indirect recursion fail before the next child run starts.
Budget and cancellation propagation remain separate unfinished parts of issue #2163. If a child
fails, its terminal error code and retryability are preserved rather than replaced with a generic
composite failure.

## Provider registry

Persisted prompt nodes store a plain provider string. This package does not own a closed provider
union or vendor list; creation and rehydration receive an injected provider-definition registry and
validate the string against it. An unknown provider yields a typed diagnostic rather than a thrown
error. The default provider when none is specified is `anthropic`, but it is still resolved through
the injected registry — provider defaults, credential declarations, and concrete SDK factories stay
owned by the composition root, and this package only ever persists the selected name.

## Template rendering

`{{portKey}}` placeholders in the system prompt template are replaced with the string value of the
corresponding input port. Unknown placeholders are left intact rather than rejected.

## Error semantics

Failure is distinguished by cause: a missing API key, a missing required input port, and an LLM
call failure are reported as distinct typed errors, with LLM call failure marked retryable so
callers can distinguish transient from configuration failures without inspecting message text.

## Non-goals / constraints

- This package follows the DAG-node composition rule: it depends on `agent-core` contracts, but
  never imports a concrete `agent-provider-*` package.
- API keys are never stored in node config — the injected provider definition resolves credentials
  at execution time.
- The system prompt template is not arbitrary code — only `{{key}}` substitution is performed.
- Only string input/output ports are supported (no binary) in Phase A.
- Nodes are held in-memory only; no persistent storage backs them beyond the process lifetime.
- Promotion to a permanent registry (Phase B) and code-evaluated nodes (Phase C) are out of scope.
