# Agents Package Decomposition Design

## Summary

Split `@robota-sdk/agents` (202 files) into 12 focused packages: `tools`, `tool-mcp`, `event-service`, and 9 individual `plugin-*` packages. The `agents` package retains the Robota facade, managers, interfaces (SSOT), and abstract base classes.

## Motivation

`@robota-sdk/agents` currently holds too many responsibilities in a single package: core agent runtime, tool ecosystem, event system, and 9 plugins with storage implementations. This violates the single-responsibility principle and makes the package unnecessarily large for consumers who only need a subset.

The DAG subsystem is already well-decomposed into 12 packages. Applying the same discipline to the agents side brings consistency across the monorepo.

## Design Decisions

### Decision 1: No backward compatibility layer

The v3.0.0 release has not been published yet. All import path changes are non-breaking. No re-exports, no deprecation shims.

### Decision 2: Plugin contracts stay in agents

`AbstractPlugin`, `AbstractTool`, and all interfaces remain in `@robota-sdk/agents` as the SSOT. Extracted packages reference agents via `peerDependency`. This avoids a separate `plugin-core` package and follows the existing pattern.

### Decision 3: MCP tools separate from core tools

`@robota-sdk/tools` contains `FunctionTool`, `OpenAPITool`, and `ToolRegistry`. MCP-specific tools (`MCPTool`, `RelayMcpTool`) go to `@robota-sdk/tool-mcp` to isolate the `@modelcontextprotocol/sdk` dependency.

### Decision 4: One package per plugin

Each plugin gets its own package including its storage implementations. This gives consumers fine-grained dependency control and independent versioning.

## Package Architecture

### New packages (12)

```
packages/
├── tools/                            # @robota-sdk/tools
├── tool-mcp/                         # @robota-sdk/tool-mcp
├── event-service/                    # @robota-sdk/event-service
├── plugin-conversation-history/      # @robota-sdk/plugin-conversation-history
├── plugin-error-handling/            # @robota-sdk/plugin-error-handling
├── plugin-event-emitter/             # @robota-sdk/plugin-event-emitter
├── plugin-execution-analytics/       # @robota-sdk/plugin-execution-analytics
├── plugin-limits/                    # @robota-sdk/plugin-limits
├── plugin-logging/                   # @robota-sdk/plugin-logging
├── plugin-performance/               # @robota-sdk/plugin-performance
├── plugin-usage/                     # @robota-sdk/plugin-usage
└── plugin-webhook/                   # @robota-sdk/plugin-webhook
```

### Dependency graph

```
@robota-sdk/agents (SSOT: interfaces, abstracts, core, managers, utils)
  ^                ^                ^
  | peerDep        | peerDep        | peerDep
  |                |                |
tools          event-service    plugin-* (x9)
  ^
  | peerDep
  |
tool-mcp ──> peerDep: @modelcontextprotocol/sdk
```

Rules:

- All new packages declare `@robota-sdk/agents` as `peerDependency`
- `tool-mcp` also declares `@robota-sdk/tools` as `peerDependency`
- No production dependency cycles
- No cross-plugin dependencies

### What stays in agents

| Directory         | Contents                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/interfaces/` | All SSOT type definitions (IAgent, IAIProvider, ITool, TUniversalMessage, etc.)                                                                                                                                                                                                                   |
| `src/abstracts/`  | AbstractPlugin, AbstractTool, AbstractAIProvider, AbstractAgent, AbstractExecutor, AbstractModule                                                                                                                                                                                                 |
| `src/core/`       | Robota facade (robota.ts, config, lifecycle, initialization, execution, module/plugin managers)                                                                                                                                                                                                   |
| `src/managers/`   | AgentFactory, AIProviderManager, ToolManager, PluginManager, ConversationHistoryManager, ModuleRegistry                                                                                                                                                                                           |
| `src/services/`   | ExecutionService, ExecutionRound, ExecutionStream, execution-types, execution-constants, execution-event-emitter, ToolExecutionService, PluginHookDispatcher, HistoryModule, InMemoryHistoryStore, conversation-service/, cache/ (EventService + task-events + user-events move to event-service) |
| `src/executors/`  | LocalExecutor                                                                                                                                                                                                                                                                                     |
| `src/utils/`      | Logger, errors, validation, message-converter, periodic-task, execution-proxy                                                                                                                                                                                                                     |
| `src/schemas/`    | Agent template schemas                                                                                                                                                                                                                                                                            |
| `src/agents/`     | Constants                                                                                                                                                                                                                                                                                         |
| `src/templates/`  | Empty directory — remove during migration                                                                                                                                                                                                                                                         |

## Package Details

### @robota-sdk/tools

**Source files (from agents):**

- `src/tools/registry/tool-registry.ts`
- `src/tools/implementations/function-tool.ts`
- `src/tools/implementations/function-tool/` (schema-converter, types)
- `src/tools/implementations/openapi-tool.ts`
- `src/tools/index.ts`

**Dependencies:**

- `peerDependencies`: `@robota-sdk/agents`, `zod`

**Exports:**

- `ToolRegistry`
- `FunctionTool`, `createFunctionTool`
- `OpenAPITool`
- Schema converter utilities

### @robota-sdk/tool-mcp

**Source files (from agents):**

- `src/tools/implementations/mcp-tool.ts`
- `src/tools/implementations/relay-mcp-tool.ts`

**Dependencies:**

- `peerDependencies`: `@robota-sdk/agents`, `@robota-sdk/tools`, `@modelcontextprotocol/sdk`

**Exports:**

- `MCPTool`
- `RelayMcpTool`

### @robota-sdk/event-service

**Source files (from agents):**

- `src/services/event-service.ts`
- `src/services/task-events.ts`
- `src/services/user-events.ts`

**Dependencies:**

- `peerDependencies`: `@robota-sdk/agents`

**Exports:**

- `EventService`
- Task event constants
- User event constants

### Plugin packages (x9)

Each plugin package follows the same structure:

```
packages/plugin-{name}/
├── package.json
├── tsconfig.json
├── src/
│   ├── {name}-plugin.ts
│   ├── types.ts
│   ├── index.ts
│   ├── storages/          # if applicable
│   │   ├── memory-storage.ts
│   │   ├── file-storage.ts
│   │   └── index.ts
│   └── __tests__/
├── docs/
│   └── SPEC.md
└── vitest.config.ts
```

**Common dependencies:**

- `peerDependencies`: `@robota-sdk/agents`

**Per-plugin contents:**

| Package                     | Plugin class              | Extra modules            | Storages                      |
| --------------------------- | ------------------------- | ------------------------ | ----------------------------- |
| plugin-conversation-history | ConversationHistoryPlugin | —                        | memory, file, database        |
| plugin-logging              | LoggingPlugin             | formatters               | console, file, remote, silent |
| plugin-usage                | UsagePlugin               | helpers, aggregation     | memory, file, remote, silent  |
| plugin-performance          | PerformancePlugin         | system-metrics-collector | memory                        |
| plugin-execution-analytics  | ExecutionAnalyticsPlugin  | analytics-aggregation    | —                             |
| plugin-error-handling       | ErrorHandlingPlugin       | context-adapter          | —                             |
| plugin-limits               | LimitsPlugin              | —                        | —                             |
| plugin-event-emitter        | EventEmitterPlugin        | metrics                  | —                             |
| plugin-webhook              | WebhookPlugin             | http-client, transformer | —                             |

Note: `event-emitter-plugin.ts` and `limits-plugin.ts` at `plugins/` root are legacy stubs that re-export from subdirectories. They are removed during migration; the subdirectory versions are canonical.

## Plugin Discovery at Runtime

Plugin registration remains consumer-driven and explicit — the same pattern as today. Consumers import a plugin class from its package and pass it to `Robota` at construction time or via `robota.use()`. There is no auto-discovery, classpath scanning, or plugin registry. This is intentional: explicit registration keeps the dependency graph transparent and tree-shakeable.

```typescript
import { Robota } from '@robota-sdk/agents';
import { LoggingPlugin } from '@robota-sdk/plugin-logging';
import { UsagePlugin } from '@robota-sdk/plugin-usage';

const robota = new Robota({
  plugins: [new LoggingPlugin({ level: 'info' }), new UsagePlugin()],
  // ...
});
```

## Import Path Migration Guide

| Before (agents)                                                         | After (new package)                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `import { FunctionTool, createFunctionTool } from '@robota-sdk/agents'` | `import { FunctionTool, createFunctionTool } from '@robota-sdk/tools'`                |
| `import { MCPTool, RelayMcpTool } from '@robota-sdk/agents'`            | `import { MCPTool, RelayMcpTool } from '@robota-sdk/tool-mcp'`                        |
| `import { EventService } from '@robota-sdk/agents'`                     | `import { EventService } from '@robota-sdk/event-service'`                            |
| `import { LoggingPlugin } from '@robota-sdk/agents'`                    | `import { LoggingPlugin } from '@robota-sdk/plugin-logging'`                          |
| `import { UsagePlugin } from '@robota-sdk/agents'`                      | `import { UsagePlugin } from '@robota-sdk/plugin-usage'`                              |
| `import { ConversationHistoryPlugin } from '@robota-sdk/agents'`        | `import { ConversationHistoryPlugin } from '@robota-sdk/plugin-conversation-history'` |
| `import { PerformancePlugin } from '@robota-sdk/agents'`                | `import { PerformancePlugin } from '@robota-sdk/plugin-performance'`                  |
| `import { ExecutionAnalyticsPlugin } from '@robota-sdk/agents'`         | `import { ExecutionAnalyticsPlugin } from '@robota-sdk/plugin-execution-analytics'`   |
| `import { ErrorHandlingPlugin } from '@robota-sdk/agents'`              | `import { ErrorHandlingPlugin } from '@robota-sdk/plugin-error-handling'`             |
| `import { LimitsPlugin } from '@robota-sdk/agents'`                     | `import { LimitsPlugin } from '@robota-sdk/plugin-limits'`                            |
| `import { EventEmitterPlugin } from '@robota-sdk/agents'`               | `import { EventEmitterPlugin } from '@robota-sdk/plugin-event-emitter'`               |
| `import { WebhookPlugin } from '@robota-sdk/agents'`                    | `import { WebhookPlugin } from '@robota-sdk/plugin-webhook'`                          |

Imports that stay in `@robota-sdk/agents` (no change): `Robota`, `AbstractPlugin`, `AbstractTool`, `AbstractAIProvider`, `AbstractAgent`, all interfaces (`IAgent`, `IAIProvider`, `ITool`, `TUniversalMessage`, etc.), `LocalExecutor`, `RobotaError`, all manager classes.

## Test Strategy

### Unit tests

Each extracted package carries its own co-located tests. Tests move with source files:

| Package                     | Test files (from agents)                                                                                                                    | What they verify                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| tools                       | `function-tool.test.ts`, `schema-converter.test.ts`                                                                                         | Tool creation, schema conversion, Zod-to-JSON-Schema |
| tool-mcp                    | (new tests needed)                                                                                                                          | MCPTool construction, relay behavior                 |
| event-service               | `event-service.test.ts`, `event-context.test.ts`                                                                                            | Event emission, owner path tracking, subscription    |
| plugin-conversation-history | `conversation-history-plugin.test.ts`, `history-storages.test.ts`                                                                           | Plugin lifecycle, storage CRUD                       |
| plugin-logging              | `logging-plugin.test.ts`, `formatters.test.ts`, `logging-storages.test.ts`                                                                  | Log formatting, storage writes                       |
| plugin-usage                | `usage-plugin.test.ts`, `aggregate-usage-stats.test.ts`, `usage-plugin-helpers.test.ts`, `memory-storage.test.ts`, `silent-storage.test.ts` | Usage tracking, aggregation                          |
| plugin-performance          | `performance-plugin.test.ts`, `system-metrics-collector.test.ts`, `memory-storage.test.ts`                                                  | Metrics collection, storage                          |
| plugin-execution-analytics  | `execution-analytics-plugin.test.ts`                                                                                                        | Analytics aggregation                                |
| plugin-error-handling       | `error-handling-plugin.test.ts`                                                                                                             | Error capture, context adaptation                    |
| plugin-limits               | (new tests needed — currently tested via integration)                                                                                       | Rate limiting, resource constraints                  |
| plugin-event-emitter        | (new tests needed — currently tested via integration)                                                                                       | Event delegation, metrics emission                   |
| plugin-webhook              | `webhook-plugin.test.ts`                                                                                                                    | HTTP delivery, payload transformation                |

### Integration tests

Integration tests that span multiple packages (e.g., Robota + plugins + tools) remain in `@robota-sdk/agents` under `src/__tests__/integration/`. These tests import the extracted packages as `devDependencies` and verify end-to-end behavior.

### Verification per phase

| Phase                      | Verification command                                                          | Pass criteria                               |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| Phase 1 (scaffolding)      | `pnpm install && pnpm build`                                                  | All new packages build with empty src       |
| Phase 2 (move files)       | `pnpm typecheck && pnpm test` per package                                     | Each package passes independently           |
| Phase 3 (update agents)    | `pnpm typecheck && pnpm test` for agents                                      | No broken imports, all remaining tests pass |
| Phase 4 (update consumers) | `pnpm typecheck` monorepo-wide                                                | Zero type errors                            |
| Phase 5 (final)            | `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm harness:scan` | All green                                   |

## Migration Plan

### Phase 1: Create package scaffolding

For each of the 12 new packages:

1. Create directory under `packages/`
2. Create `package.json` with name, version (3.0.0), peerDependencies
3. Create `tsconfig.json` extending root config (`"strict": true` required)
4. Create `vitest.config.ts`
5. Create `docs/SPEC.md` (using spec template)

### Phase 2: Move source files

For each package:

1. Move source files from `agents/src/` to new package `src/`
2. Update internal import paths
3. Update `index.ts` exports

### Phase 3: Update agents package

1. Remove moved files from `agents/src/`
2. Remove re-exports from `agents/src/index.ts`
3. Add new packages as `devDependencies` for testing
4. Update `agents/docs/SPEC.md` to reflect reduced scope

### Phase 4: Update consumers

1. Update `apps/` import paths
2. Update other `packages/` import paths (team, sessions, providers)
3. Update `pnpm-workspace.yaml` to include new packages

### Phase 5: Verify

1. `pnpm install`
2. `pnpm build`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm lint`
6. `pnpm harness:scan`

## Risks and Mitigations

| Risk                                 | Impact                                        | Mitigation                                                                                                          |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Circular dependency during migration | Build failure                                 | Move files in dependency order: event-service first, then tools, then plugins                                       |
| Missed import path updates           | Type errors                                   | Run `pnpm typecheck` after each phase                                                                               |
| Test fixtures referencing old paths  | Test failures                                 | Update test imports in same PR as source move                                                                       |
| pnpm workspace resolution            | Install failure                               | Add all new packages to `pnpm-workspace.yaml` before moving files                                                   |
| Peer dependency version drift        | Incompatible versions after agents minor bump | All packages use `"@robota-sdk/agents": "workspace:*"` in monorepo; published versions use `">=3.0.0"` semver range |
| Increased onboarding complexity      | New contributors confused by 15+ packages     | Import Path Migration Guide in this doc; README updated; each package has SPEC.md                                   |

## Success Criteria

- [ ] All 12 new packages build independently
- [ ] `@robota-sdk/agents` builds with reduced scope
- [ ] No circular dependencies between packages
- [ ] `pnpm typecheck` passes across entire monorepo
- [ ] All existing tests pass (relocated to new packages)
- [ ] `pnpm harness:scan` passes
- [ ] Each new package has `docs/SPEC.md`
