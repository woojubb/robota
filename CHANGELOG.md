# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0-beta] — in progress (latest: 3.0.0-beta.79)

Robota 3.0 ships as a rolling `3.0.0-beta.N` prerelease cadence — the current published line is
`3.0.0-beta.79`. **A final `3.0.0` has not been released.** All published `@robota-sdk/agent-*`
packages version together at `3.0.0-beta.79`, except `@robota-sdk/agent-process`, which is
versioned independently. Entries below summarize the 3.0 beta line to date.

### ✨ Recent highlights (through beta.79)

- **FLOW-007 — `/workflows create`**: `agent-cli` gained `/workflows create "<natural language>"`,
  which authors a workflow from a natural-language description using the CLI's **active provider**,
  runs it immediately in-process, and saves it as a reusable, model-invocable
  `.workflows/<name>.json` artifact (with any prompt-backed nodes under `.workflows/nodes/`).
- **`.workflows/` storage**: workspace-local workflow and node artifacts persist under `.workflows/`
  (default workspace layout), so authored workflows can be re-run and shared.
- **INFRA-028 — self-contained `agent-cli` bundle**: `@robota-sdk/agent-cli` now publishes as a
  self-contained bundle. The entire private DAG/workflow subsystem (`dag-*`,
  `agent-command-workflows`) is bundled into its `dist` rather than published as separate packages;
  runtime `dependencies` contain only third-party npm packages.
- **DATA-003 — instant-node provider SSOT + persistence round-trip**: a single source of truth for
  instant-node providers with symmetric save/load persistence, so authored nodes round-trip cleanly
  through `.workflows/`.

### 🚨 Breaking Changes

#### @robota-sdk/agent-core — API Surface Overhaul

- **Type naming convention**: All interfaces use `I*` prefix, type aliases use `T*` prefix
  - `ToolSchema` → `IToolSchema`, `ProviderOptions` → `IProviderOptions`
  - `AgentConfig` → `IAgentConfig`, `AgentTemplate` → `IAgentTemplate`
  - `ToolCall` → `IToolCall`, `UserMessage` → `IUserMessage`, `SystemMessage` → `ISystemMessage`, `ToolMessage` → `IToolMessage`
  - `UniversalMessage` → `TUniversalMessage`
  - `ErrorHandlingStrategy` → `TErrorHandlingStrategy`, `LimitsStrategy` → `TLimitsStrategy`
  - `EventType` → `TEventName`, `WebhookEventType` → `TWebhookEventName`
- **Class rename**: `BaseAIProvider` → `AbstractAIProvider`
- **Module path change**: `Robota` import path changed from `./agents/robota` to `./core/robota`
- **Removed re-export**: `ToolSchema as FunctionSchema` alias removed
- **New required exports**: `IAgent`, `IRunOptions`, `IProviderRequest`, `IRawProviderResponse`

#### @robota-sdk/agent-session — Complete Rewrite

- Removed: `ConversationServiceImpl`, `SystemMessageManagerImpl`, `MultiProviderAdapterManager`
- Removed: `ContextManager`, `ProviderManager`, `ProviderConfig`, `EnhancedConversationHistory`
- Removed: Message editing/deletion functionality
- Added: `SessionManager`, `TemplateManagerAdapter`
- Simplified type exports (`ISessionConfig`, `IChatConfig`, etc.)

#### @robota-sdk/agent-team — Architecture Change

- Removed: `TeamContainer`, `createTeam`, `TeamOptions`, `TeamContainerOptions`
- Added: Relay tool-based architecture (`listTemplateCategoriesTool`, `createAssignTaskRelayTool`, etc.)

#### @robota-sdk/agent-provider (`/openai` sub-path)

> Providers are consolidated into the single `@robota-sdk/agent-provider` package and exposed as
> sub-paths (`/openai`, `/anthropic`, `/google`, `/bytedance`, `/gemma`, …). There are no standalone
> `@robota-sdk/agent-provider-openai` / `-anthropic` / `-bytedance` packages.

- Removed: `PayloadLogger` class export
- Added: `IPayloadLogger`, `IPayloadLoggerOptions` type-only exports

#### @robota-sdk/agent-provider (`/anthropic` sub-path)

- `AnthropicProviderOptions` → `IAnthropicProviderOptions`

### ✨ Added

#### New Packages

- **@robota-sdk/agent-provider**: consolidated multi-provider package. ByteDance (Doubao) support is
  added via the `/bytedance` sub-path — there is no standalone `@robota-sdk/agent-provider-bytedance`.
- **@robota-sdk/agent-remote-client** _(private, bundled)_: remote executor client with HTTP client
  and WebSocket transport. (There is no `@robota-sdk/agent-remote` or `agent-remote-server-core`.)
- **@robota-sdk/agent-playground** _(private)_: interactive AI playground.

#### DAG / Workflow Engine — internal (bundled into agent-cli, not published)

> These packages are **private** (`private: true`) and are **not** released to npm as
> `@robota-sdk/dag-*`. They ship bundled inside `@robota-sdk/agent-cli` (INFRA-028) and are surfaced
> to users through the `/workflows` command. Listed here for changelog completeness only.

- **dag-core / dag-runtime / dag-worker / dag-scheduler / dag-projection**: orchestration, run,
  worker, scheduler, and projection services.
- **dag-api / dag-mcp-server / dag-cli**: REST, MCP, and CLI surfaces.
- **dag-node / dag-nodes**: node contracts and built-in node-type implementations.
- **agent-command-workflows**: the `/workflows` command module (also private/bundled).

#### @robota-sdk/agent-core — New Features

- **Media providers**: `IImageGenerationProvider`, `IVideoGenerationProvider` with type guards
- **Event service system**: `AbstractEventService`, `StructuredEventService`, `ObservableEventService`
- **Event constants**: `EXECUTION_EVENTS`, `TOOL_EVENTS`, `AGENT_EVENTS`, `TASK_EVENTS`, `USER_EVENTS`
- **Executor architecture**: `LocalExecutor`, `AbstractExecutor`, `IExecutor` interface
- **Event history module**: `EventHistoryModule` with snapshot support
- **MCP relay tool**: `RelayMcpTool` for MCP server integration
- **Execution proxy**: `ExecutionProxy`, `createExecutionProxy`, `withEventEmission`
- **Workflow contracts**: `IWorkflowConverter`, `IWorkflowValidator` interfaces
- **Logger**: `SilentLogger`, `ILogger` interface export

### 🔧 Changed

- Code review-based refactoring across agents, sessions, and team packages
- Complexity and file size violations resolved (300-line limit enforcement)
- Helper extraction to reduce file complexity in agents and playground
- Plugin system: frontend-design and github plugins enabled

### 🐛 Fixed

- **dag-worker**: Finalization classification error in task completion
- **dag-worker**: Downstream dispatch atomicity guarantee
- **dag-worker**: DLQ reinject concurrency safety (lease mechanism added)

## [2.0.0-rc.1] - 2025-01-06

### 🚨 Breaking Changes

#### Architecture Overhaul

- **Plugin-Module Separation**: Complete separation of plugin and module systems for better modularity
- **Provider Implementation**: All AI providers now must extend `BaseAIProvider` from `@robota-sdk/agent-core`
- **Type System**: Strict TypeScript enforcement with zero tolerance for `any`/`unknown` types
- **Import Paths**: Updated import paths for all public APIs

#### Deprecated Packages

- `@robota-sdk/core` - Functionality moved to `@robota-sdk/agent-core`
- `@robota-sdk/agent-tools` - Integrated into `@robota-sdk/agent-core`

### ✨ Added

#### Core Features

- **BaseAIProvider**: New abstract base class for all AI provider implementations
- **Type-Safe Architecture**: Complete type safety across all packages
- **Plugin System**: Enhanced plugin architecture with lifecycle hooks
- **Module Registry**: New module registration and management system
- **Event System**: Comprehensive event emitter for all agent operations

#### Documentation

- **API Reference**: Auto-generated TypeDoc documentation for all packages
- **Migration Guide**: Comprehensive guide for upgrading from v1.x
- **Provider Guidelines**: Clear implementation guidelines for AI providers

#### Development

- **Cursor Rules**: Added development rules for consistent coding practices
- **TypeScript Policy**: Documented strict TypeScript policies
- **Research Documentation**: Guidelines for documenting API-specific behaviors

### 🐛 Fixed

#### Provider Issues

- **OpenAI**: Fixed content handling for tool calls (null vs empty string)
- **Anthropic**: Corrected API-specific content requirements
- **Google**: Resolved Gemini API type compatibility issues

#### Type Safety

- Eliminated all `any` and `unknown` types across the codebase
- Fixed type inference issues in generic implementations
- Resolved circular dependency type errors

#### Build System

- Fixed ESM/CJS dual package exports
- Corrected TypeScript configuration for test files
- Resolved workspace dependency resolution issues

### 🔧 Changed

#### Package Structure

- Reorganized package exports for better tree-shaking
- Updated build configuration for optimal bundle sizes
- Improved TypeScript declaration file generation

#### API Improvements

- Standardized error handling across all providers
- Unified message format handling
- Consistent metadata structure

#### Testing

- Enhanced test coverage for all packages
- Added provider-specific integration tests
- Improved test file organization

### 📦 Dependencies

#### Updated

- `@anthropic-ai/sdk`: Latest version
- `@google/generative-ai`: Latest version
- `openai`: Latest version
- TypeScript: 5.3.3

#### Security

- Addressed development dependency vulnerabilities
- No production security issues

### 📝 Documentation

- Complete API reference documentation
- Updated README files for all packages
- Enhanced inline code documentation
- Added provider-specific implementation notes

### 🏗️ Infrastructure

- GitHub Actions workflow improvements
- Documentation build automation
- Release process standardization
- Monorepo structure optimization

## Migration Guide

### From v1.x to v2.0.0-rc.1

1. **Update Imports**:

   ```typescript
   // Old
   import { Robota } from '@robota-sdk/core';

   // New
   import { Robota } from '@robota-sdk/agent-core';
   ```

2. **Provider Implementation**:

   ```typescript
   // All providers must now extend AbstractAIProvider
   // (renamed from BaseAIProvider in the 3.0 line — see Breaking Changes above)
   export class MyProvider extends AbstractAIProvider {
     // Implementation
   }
   ```

3. **Deprecated Packages**:
   - Replace `@robota-sdk/core` with `@robota-sdk/agent-core`
   - Replace `@robota-sdk/agent-tools` with tool functionality in `@robota-sdk/agent-core`

4. **Type Updates**:
   - Remove all `any` types and replace with specific types
   - Update `unknown` types to proper type definitions

For detailed migration instructions, see the [Migration Guide](./content/guide/migration.md).

---

[2.0.0-rc.1]: https://github.com/woojubb/robota/releases/tag/v2.0.0-rc.1
