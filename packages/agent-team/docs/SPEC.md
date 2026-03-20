# Team Specification

## Scope

- Owns multi-agent teamwork behavior for Robota, including template-based task assignment, agent coordination, and delegation-oriented orchestration.
- Provides a set of tools (FunctionTool and RelayMcpTool) that allow a parent agent to dynamically spawn and delegate work to child agent instances using predefined templates.
- Manages a built-in template registry that defines agent configurations (provider, model, temperature, system message) for common task archetypes.

## Boundaries

- Does not redefine core agent contracts. `Robota`, tool interfaces (`IToolSchema`, `IToolResult`, `TToolParameters`), and event interfaces (`IEventService`, `IAIProvider`) are imported from `@robota-sdk/agent-core`. `FunctionTool` is imported from `@robota-sdk/agent-tools`. `RelayMcpTool` is imported from `@robota-sdk/agent-tool-mcp`. `bindWithOwnerPath` is imported from `@robota-sdk/agent-event-service`.
- Keeps team coordination policies explicit and separate from provider integration.
- Does not own AI provider implementations; provider and model selection is resolved through `@robota-sdk/agent-core` infrastructure.
- Does not manage session persistence or conversation history; those concerns belong to `@robota-sdk/agent-sessions`.
- Template definitions are static JSON; no runtime template creation or persistence API is exposed.

## Architecture Overview

The package follows a single-layer structure with one functional module:

```
src/
  index.ts                          # Public barrel export
  assign-task/
    relay-assign-task.ts            # Tool definitions and relay logic
    templates.json                  # Built-in template registry
```

**Design patterns used:**

- **Tool-as-capability pattern**: Each team operation is exposed as a tool instance (`FunctionTool` or `RelayMcpTool`) that agents can invoke, following the Robota tool protocol.
- **Relay delegation**: `createAssignTaskRelayTool` creates a `RelayMcpTool` that spawns a new `Robota` agent instance with template-derived configuration, executes a prompt, and returns the result. The relay tool receives an `IEventService` for owner-path-aware event propagation.
- **Owner path propagation**: When delegating, the relay tool extends the caller's `ownerPath` with a new agent segment, ensuring traceability through the event system.
- **Template registry**: Agent configurations are defined declaratively in `templates.json` and looked up by ID at execution time.

## Type Ownership

This package defines a minimal set of local types. Most types are imported from `@robota-sdk/agent-core`.

| Type             | Kind              | Owner                    | Description                                                                                    |
| ---------------- | ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `ITemplateEntry` | interface (local) | `@robota-sdk/agent-team` | Shape of a template record: id, name, description, provider, model, temperature, systemMessage |

All other types used in the public API (`IToolSchema`, `IToolResult`, `TToolParameters`, `IEventService`, `IAIProvider`, `IAgentConfig`, `IOwnerPathSegment`, `Robota`) are owned by `@robota-sdk/agent-core`. `FunctionTool` is owned by `@robota-sdk/agent-tools`. `RelayMcpTool` is owned by `@robota-sdk/agent-tool-mcp`.

## Public API Surface

| Export                       | Kind                    | Description                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `listTemplateCategoriesTool` | `FunctionTool` instance | Returns the list of template categories. Currently returns a single "Default Templates" category.                                                                                                                                                                                                                  |
| `listTemplatesTool`          | `FunctionTool` instance | Returns available templates, optionally filtered by category. Returns id, name, description, and categoryId for each template.                                                                                                                                                                                     |
| `getTemplateDetailTool`      | `FunctionTool` instance | Returns full details of a specific template by `templateId`. Throws if the template is not found.                                                                                                                                                                                                                  |
| `createAssignTaskRelayTool`  | factory function        | `(eventService: IEventService, aiProviders: IAIProvider[]) => RelayMcpTool`. Creates a relay tool that spawns a `Robota` agent from a template and runs a job description prompt. Required params: `templateId`, `jobDescription`. Optional overrides: `provider`, `model`, `temperature`, `maxTokens`, `context`. |

### Tool Schemas

| Tool Name                | Required Parameters                            | Optional Parameters                                                                                |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `listTemplateCategories` | (none)                                         | (none)                                                                                             |
| `listTemplates`          | (none)                                         | `categoryId: string`                                                                               |
| `getTemplateDetail`      | `templateId: string`                           | (none)                                                                                             |
| `assignTask`             | `templateId: string`, `jobDescription: string` | `provider: string`, `model: string`, `temperature: number`, `maxTokens: number`, `context: string` |

### Built-in Templates

| Template ID        | Name             | Provider | Model       |
| ------------------ | ---------------- | -------- | ----------- |
| `general`          | General Purpose  | openai   | gpt-4o-mini |
| `task_coordinator` | Task Coordinator | openai   | gpt-4o-mini |

## Extension Points

- **Custom templates**: Consumers cannot currently add templates at runtime. The template list is loaded from a static JSON file compiled into the package. To extend, the JSON file must be modified at the source level.
- **Relay tool creation**: `createAssignTaskRelayTool` accepts an `IEventService`, allowing consumers to wire the relay tool into any event infrastructure that implements the interface.
- **Parameter overrides**: The `assignTask` tool accepts optional `provider`, `model`, `temperature`, and `maxTokens` overrides, allowing callers to customize agent behavior per invocation without modifying templates.

## Error Taxonomy

This package does not define a custom error hierarchy. It relies on:

- Standard JavaScript `Error` throws for missing required parameters and missing templates (in `getTemplateDetailTool` and the relay tool).
- `IToolResult` with `{ success: false, error: string }` for relay tool validation failures (missing `templateId`, missing `jobDescription`, template not found).
- Context validation errors thrown with `[ASSIGN-TASK]` prefix when the relay execution context is missing required fields (`eventService`, `baseEventService`, `agentId`).

All underlying agent execution errors propagate from `@robota-sdk/agent-core`.

## Class Contract Registry

### Interface Implementations

None. This package defines no classes. All exports are tool instances created via factory functions. `FunctionTool` is from `@robota-sdk/agent-tools`; `RelayMcpTool` is from `@robota-sdk/agent-tool-mcp`.

### Cross-Package Port Consumers

| Port (Owner)                              | Consumer                                                                   | Location                               |
| ----------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `FunctionTool` (agent-tools)              | `listTemplateCategoriesTool`, `listTemplatesTool`, `getTemplateDetailTool` | `src/assign-task/relay-assign-task.ts` |
| `RelayMcpTool` (agent-tool-mcp)           | `createAssignTaskRelayTool` result                                         | `src/assign-task/relay-assign-task.ts` |
| `IEventService` (agents)                  | `createAssignTaskRelayTool` parameter                                      | `src/assign-task/relay-assign-task.ts` |
| `IAIProvider` (agents)                    | `createAssignTaskRelayTool` parameter                                      | `src/assign-task/relay-assign-task.ts` |
| `bindWithOwnerPath` (agent-event-service) | relay tool owner-path propagation                                          | `src/assign-task/relay-assign-task.ts` |

## Test Strategy

### Current State

- **1 test file exists**: `src/assign-task/relay-assign-task.test.ts` (182 lines) covering relay tool execution, parameter validation, and error paths.
- An offline verification scenario exists at `examples/verify-offline.ts` that exercises `listTemplateCategoriesTool`, `listTemplatesTool`, and `getTemplateDetailTool` without network calls.
- Scenario record artifact: `examples/scenarios/offline-verify.record.json`.

### Gaps

- No unit tests for `listTemplateCategoriesTool`, `listTemplatesTool`, or `getTemplateDetailTool`.
- No integration tests verifying event service interaction during relay execution.
