# Instant Node

`@robota-sdk/dag-node-instant-node` (internal) lets an agent define new DAG node types at run time,
without writing TypeScript. Each definition's node type, display name and ports come from the spec
it is created with (category `Instant`). The `/workflows` command in `agent-command-workflows` uses
it to create and reload saved instant nodes.

- **`PromptBackedNodeDefinition`** (`createPromptBackedNodeDefinition(spec, providers)`) — an LLM
  node. Its string input ports fill `{{portKey}}` placeholders in `spec.systemPromptTemplate`; the
  rendered text is sent as the prompt, and the reply goes to its one string output port. Config:
  `model` (string, optional; overrides `spec.model`). The provider is `spec.provider` (default
  `anthropic`), resolved through the injected `IProviderDefinition[]` registry; its definition
  declares the credential variable, and a missing credential is a validation error.
- **`CompositeInstantNodeDefinition`** (`createCompositeInstantNodeDefinition(spec)`) — wraps an inner
  DAG behind one exposed input port and one or more exposed output ports, and runs it through an
  injected `ICompositeSubRunner`. Nesting depth is capped, and an inner DAG that contains its own or
  an ancestor's node type is rejected before it runs.

Both kinds are persistable: `toPersisted()` writes a record, `parsePersistedInstantNode` validates
an untrusted record, and `rehydrateInstantNode` rebuilds the definition (a composite needs a
`compositeRunner`). `isPersistableInstantNode` checks whether a node supports this. Cost estimates
are 0.

Contract: [SPEC.md](SPEC.md).
