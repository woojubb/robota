# SPEC: @robota-sdk/dag-node-instant-node

## Package Identity

| Field    | Value                               |
| -------- | ----------------------------------- |
| Package  | `@robota-sdk/dag-node-instant-node` |
| Location | `packages/dag-nodes/instant-node`   |
| Layer    | Node implementation                 |
| Phase    | VISION-003 Phase A                  |

## Purpose

Enables AI agents to create custom DAG node types at runtime without writing TypeScript or restarting any process. Phase A delivers **Prompt-Backed Instant Nodes**: nodes whose execution behavior is defined by a system prompt template applied to input port values.

## Exports

```typescript
export type { ICreatePromptNodeInput };
export { PromptBackedNodeDefinition, createPromptBackedNodeDefinition };
export type {
  ICreateCompositeNodeInput,
  IExposedInputPort,
  IExposedOutputPort,
  ICompositeSubRunner,
};
export { CompositeInstantNodeDefinition, createCompositeInstantNodeDefinition };
// Persistence view (BEHAVIOR-006)
export type {
  IPersistableInstantNode,
  IPersistedPromptNode,
  IPersistedCompositeNode,
  TPersistedInstantNode,
};
// Provider-definition registry + persistence round-trip (DATA-003)
export { isPersistableInstantNode };
export { parsePersistedInstantNode, rehydrateInstantNode };
export type { IRehydrateInstantNodeDeps };
```

## Persistence View (BEHAVIOR-006)

Each instant-node definition owns the serializable data needed to reload it, exposed via
`IPersistableInstantNode.toPersisted(): TPersistedInstantNode`. This lets a persistence layer
serialize a node from its `IDagNodeDefinition` alone (at any save call site) and reconstruct it
later — the `runner` of a composite is behavioral and is **rebuilt on reload**, never serialized.

```typescript
interface IPersistableInstantNode {
  toPersisted(): TPersistedInstantNode;
}

type TPersistedInstantNode = IPersistedPromptNode | IPersistedCompositeNode;

interface IPersistedPromptNode {
  readonly kind: 'prompt';
  readonly nodeType: string;
  readonly displayName: string;
  readonly systemPromptTemplate: string;
  readonly inputPorts: ReadonlyArray<{ readonly key: string; readonly description?: string }>;
  readonly outputPort: { readonly key: string; readonly description?: string };
  readonly provider?: string;
  readonly model?: string;
}

interface IPersistedCompositeNode {
  readonly kind: 'composite';
  readonly nodeType: string;
  readonly displayName: string;
  readonly innerDag: IDagDefinition; // from @robota-sdk/dag-core
  readonly exposedInputPort: IExposedInputPort;
  readonly exposedOutputPorts: ReadonlyArray<IExposedOutputPort>;
  readonly maxDepth?: number;
}
```

Both `PromptBackedNodeDefinition` and `CompositeInstantNodeDefinition` implement
`IPersistableInstantNode`. This package owns **both halves** of the round-trip (DATA-003):

- `isPersistableInstantNode(node): node is IPersistableInstantNode` — runtime guard (replaces
  duck-typed `as unknown as` probes at call sites).
- `parsePersistedInstantNode(raw: unknown): TPersistedInstantNode | null` — validate/narrow an
  untrusted parsed manifest into a typed record (both kinds); never throws.
- `rehydrateInstantNode(record, { compositeRunner?, providers? }): IDagNodeDefinition` — the read half of
  `toPersisted()`. Prompt → `createPromptBackedNodeDefinition` after validating the persisted provider
  against the injected `IProviderDefinition[]`; composite →
  `createCompositeInstantNodeDefinition` with the injected `compositeRunner` (its runner is behavioral
  and never serialized). A composite record **without** a runner throws — never a half-built node.

Consumers no longer hand-roll deserialization; they parse + rehydrate through the owner.

## Provider Registry (DATA-003)

Persisted prompt nodes store a plain provider string. The node package does not own a closed provider
union or vendor list; creation and rehydration receive an injected `IProviderDefinition[]` registry
and validate the string through `findProviderDefinition`. An unknown provider returns the typed
`DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN` diagnostic. Provider definitions are retained as a
runtime seam so the composition root owns concrete SDK selection and credential resolution.

## ICreatePromptNodeInput

```typescript
interface ICreatePromptNodeInput {
  nodeType: string; // unique identifier for the new node type
  displayName: string; // human-readable name
  systemPromptTemplate: string; // {{portKey}} placeholders replaced at execution time
  inputPorts: ReadonlyArray<{
    readonly key: string;
    readonly description?: string;
  }>;
  outputPort: {
    readonly key: string;
    readonly description?: string;
  };
  provider?: string;
  model?: string;
}
```

## PromptBackedNodeDefinition

Extends `AbstractNodeDefinition`. Dynamically sets:

- `nodeType`, `displayName` from spec
- `inputs` derived from `spec.inputPorts` (all type `string`, required)
- `outputs` derived from `spec.outputPort` (type `string`, required)
- `defaultInputPort` = first input port key (for auto-wiring in `dag_build`)
- `defaultOutputPort` = output port key

Config schema: `{ model?: string }` — allows per-node-instance model override.

## Template Rendering

`{{portKey}}` placeholders in `systemPromptTemplate` are replaced with the
string value of the corresponding input port. All input port values are
rendered as strings. Unknown placeholders are left intact.

## Provider Support (Phase A)

The default provider when not specified is `anthropic`, but it is still resolved through the injected
registry. Provider defaults, credential declarations, and concrete SDK factories are owned by the
composition root (normally `agent-builtin-providers`); this package only persists the selected name.

## Error Handling

- Missing API key → `buildValidationError('DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED', ...)`
- Missing required input port → `buildValidationError('DAG_VALIDATION_NODE_INPUT_MISSING', ...)`
- LLM call failure → `buildTaskExecutionError('DAG_TASK_EXECUTION_LLM_GENERATION_FAILED', ..., retryable: true)`

## Constraints

- This package follows the DAG-node composition rule: it depends on `agent-core` contracts, but does
  not import concrete `agent-provider-*` packages.
- API keys are never stored in node config — the injected provider definition resolves credentials at
  execution time.
- `systemPromptTemplate` must not be treated as arbitrary code — only `{{key}}` substitution is performed.

## Phase A Limitations

- Only string input/output ports (no binary)
- No persistent storage — nodes live in-memory for the duration of the MCP server process
- Promotion to permanent registry is out of scope (Phase B)
- Code-evaluated nodes are out of scope (Phase C)
