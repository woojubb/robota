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
```

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
  provider?: 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'qwen';
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

| `provider`  | Provider class      | Default model       | Required env var    |
| ----------- | ------------------- | ------------------- | ------------------- |
| `anthropic` | `AnthropicProvider` | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| `openai`    | `OpenAIProvider`    | `gpt-4o-mini`       | `OPENAI_API_KEY`    |
| `gemini`    | `GoogleProvider`    | `gemini-2.0-flash`  | `GEMINI_API_KEY`    |
| `deepseek`  | `DeepSeekProvider`  | `deepseek-chat`     | `DEEPSEEK_API_KEY`  |
| `qwen`      | `QwenProvider`      | `qwen-turbo`        | `DASHSCOPE_API_KEY` |

Default provider when not specified: `anthropic`.

## Error Handling

- Missing API key → `buildValidationError('DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED', ...)`
- Missing required input port → `buildValidationError('DAG_VALIDATION_NODE_INPUT_MISSING', ...)`
- LLM call failure → `buildTaskExecutionError('DAG_TASK_EXECUTION_LLM_GENERATION_FAILED', ..., retryable: true)`

## Constraints

- This package follows the same dependency rules as `packages/dag-nodes/*`:
  `@robota-sdk/agent-*` packages may be imported as npm semver deps.
- API keys are never stored in node config — resolved from `process.env` at execution time.
- `systemPromptTemplate` must not be treated as arbitrary code — only `{{key}}` substitution is performed.

## Phase A Limitations

- Only string input/output ports (no binary)
- No persistent storage — nodes live in-memory for the duration of the MCP server process
- Promotion to permanent registry is out of scope (Phase B)
- Code-evaluated nodes are out of scope (Phase C)
