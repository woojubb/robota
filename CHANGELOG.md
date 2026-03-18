# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-03-08

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

#### @robota-sdk/agent-sessions — Complete Rewrite

- Removed: `ConversationServiceImpl`, `SystemMessageManagerImpl`, `MultiProviderAdapterManager`
- Removed: `ContextManager`, `ProviderManager`, `ProviderConfig`, `EnhancedConversationHistory`
- Removed: Message editing/deletion functionality
- Added: `SessionManager`, `TemplateManagerAdapter`
- Simplified type exports (`ISessionConfig`, `IChatConfig`, etc.)

#### @robota-sdk/agent-team — Architecture Change

- Removed: `TeamContainer`, `createTeam`, `TeamOptions`, `TeamContainerOptions`
- Added: Relay tool-based architecture (`listTemplateCategoriesTool`, `createAssignTaskRelayTool`, etc.)

#### @robota-sdk/agent-provider-openai

- Removed: `PayloadLogger` class export
- Added: `IPayloadLogger`, `IPayloadLoggerOptions` type-only exports

#### @robota-sdk/agent-provider-anthropic

- `AnthropicProviderOptions` → `IAnthropicProviderOptions`

### ✨ Added

#### New Packages

- **@robota-sdk/agent-provider-bytedance**: ByteDance AI provider (Doubao model support)
- **@robota-sdk/agent-remote**: Remote executor with HTTP client and WebSocket transport
- **@robota-sdk/agent-remote-server-core**: Server-side routes for remote execution
- **@robota-sdk/agent-playground**: Interactive AI playground

#### DAG Workflow Engine (9 packages)

- **@robota-sdk/dag-core**: Core contracts, state machines, node lifecycle, definition services
- **@robota-sdk/dag-runtime**: Run orchestration, query, and cancellation services
- **@robota-sdk/dag-worker**: Worker loop service, DLQ reinject service
- **@robota-sdk/dag-scheduler**: Scheduler trigger service
- **@robota-sdk/dag-projection**: Projection read-model service
- **@robota-sdk/dag-api**: REST API controllers and composition roots
- **@robota-sdk/dag-server-core**: Server bootstrap, asset store, OpenAPI spec
- **@robota-sdk/dag-designer**: Designer UI components, hooks, and API client
- **@robota-sdk/dag-node-\***: 10 node type implementations (gemini-image-edit, image-loader, image-source, input, llm-text-openai, ok-emitter, seedance-video, text-output, text-template, transform)

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
   import { Robota } from '@robota-sdk/agent-core';

   // New
   import { Robota } from '@robota-sdk/agent-core';
   ```

2. **Provider Implementation**:

   ```typescript
   // All providers must now extend BaseAIProvider
   export class MyProvider extends BaseAIProvider {
     // Implementation
   }
   ```

3. **Deprecated Packages**:
   - Replace `@robota-sdk/core` with `@robota-sdk/agent-core`
   - Replace `@robota-sdk/agent-tools` with tool functionality in `@robota-sdk/agent-core`

4. **Type Updates**:
   - Remove all `any` types and replace with specific types
   - Update `unknown` types to proper type definitions

For detailed migration instructions, see the [Migration Guide](./docs/migration-guide.md).

---

[2.0.0-rc.1]: https://github.com/woojubb/robota/releases/tag/v2.0.0-rc.1
