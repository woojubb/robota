---
title: Migrating to 3.0
description: Upgrade from the Robota SDK 2.x packages and earlier 3.0 versions.
---

# Migrating to 3.0

> **Version:** Platform support, entries and host APIs on this page target the 3.1.0 release. Install
> 3.1.0 or later after it is published, and check the exports in your installed version.
> The 3.0.7 framework package does not export `@robota-sdk/agent-framework/node`.

The 3.0.7 SDK is published. This source describes the planned 3.1.0 platform changes; check the
registry and install that release only after it is published. npm dist-tags can move, so check the
version installed before relying on its exports.

This guide has two parts: moving from the 2.x packages, and changes between 3.0.0 betas.

---

## From 2.x

### Package map

The 2.x packages had short names; 3.0 packages are named by role.

| 2.x package                             | 3.0 package                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agents`                    | `@robota-sdk/agent-core`, plus `@robota-sdk/agent-plugin` and `@robota-sdk/agent-tools` (see below) |
| `@robota-sdk/openai`                    | `@robota-sdk/agent-provider-openai`                                                                 |
| `@robota-sdk/anthropic`                 | `@robota-sdk/agent-provider-anthropic`                                                              |
| `@robota-sdk/google`                    | `@robota-sdk/agent-provider-gemini`                                                                 |
| `@robota-sdk/sessions`                  | Removed; see [Sessions](#sessions)                                                                  |
| `@robota-sdk/team`                      | Removed; see [Multi-agent work](#multi-agent-work)                                                  |
| `@robota-sdk/core`, `@robota-sdk/tools` | Already deprecated in 2.x in favor of `@robota-sdk/agents`; migrate as for `agents`                 |

```diff
-  "@robota-sdk/agents": "^2.0.9",
-  "@robota-sdk/openai": "^2.0.9",
-  "@robota-sdk/anthropic": "^2.0.9",
-  "@robota-sdk/google": "^2.0.9",
+  "@robota-sdk/agent-core": "^3.1.0",
+  "@robota-sdk/agent-plugin": "^3.1.0",
+  "@robota-sdk/agent-provider-openai": "^3.1.0",
+  "@robota-sdk/agent-provider-anthropic": "^3.1.0",
+  "@robota-sdk/agent-provider-gemini": "^3.1.0",
```

Each provider package brings its vendor SDK (`openai`, `@anthropic-ai/sdk`, `@google/genai`) as its
own dependency.

The provider packages named here, and the other packages that 3.3 merged, are subpaths of `@robota-sdk/agent-provider` and
the other merged packages today, and a vendor SDK is an optional peer the application installs; see
[Packages merged into subpaths](#packages-merged-into-subpaths) for the current names.

### What stays the same

Most of the 2.x `@robota-sdk/agents` API is in `@robota-sdk/agent-core` under the same names:
`Robota`, `AbstractAIProvider`, `AbstractPlugin`, `PluginCategory`, `PluginPriority`,
`EventEmitterPlugin`, `FunctionTool`, `ToolRegistry`, `AgentFactory`, `AgentTemplates`,
`ConversationHistory`, the error classes, and the `I*`/`T*` types such as `IAgentConfig`,
`IToolSchema` and `TUniversalMessage`. The `Robota` constructor takes the same core options
(`name`, `aiProviders`, `defaultModel`, `tools`, `plugins`, `systemMessage`), and `run()`,
`runStream()` and `setModel()` work as before.

The OpenAI and Anthropic providers keep their exports (`OpenAIProvider`, `IOpenAIProviderOptions`,
`AnthropicProvider`, `IAnthropicProviderOptions`, `createAnthropicProvider`); only the import path
changes:

<!-- doc-example-skip: 2.x/3.0 before/after contrast — the 2.x packages are not installed -->

```typescript
// 2.x
import { ConversationAgent } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

// 3.0
import { ConversationAgent } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
```

### Renamed: the Google provider

| 2.x (`@robota-sdk/google`)   | 3.0 (`@robota-sdk/agent-provider-gemini`) |
| ---------------------------- | ----------------------------------------- |
| `GoogleProvider`             | `GeminiProvider`                          |
| `IGoogleProviderOptions`     | `IGeminiProviderOptions`                  |
| `TGoogleProviderOptionValue` | `TGeminiProviderOptionValue`              |

The provider now uses Google's `@google/genai` SDK. Check your options against
[Providers — Gemini](./providers.md#gemini).

### Moved out of `@robota-sdk/agents`

**Plugins** moved to `@robota-sdk/agent-plugin`: `ConversationHistoryPlugin`, `ErrorHandlingPlugin`,
`ExecutionAnalyticsPlugin`, `LimitsPlugin`, `LoggingPlugin`, `PerformancePlugin`, `UsagePlugin`,
`WebhookPlugin`, their option and stats types (`ILoggingPluginOptions`, `TLimitsStrategy`,
`TErrorHandlingStrategy`, `TWebhookEventName`, …), the usage and performance storages
(`MemoryUsageStorage`, `FileUsageStorage`, `RemoteUsageStorage`, `SilentUsageStorage`,
`MemoryPerformanceStorage`) and `aggregateUsageStats`; `NodeSystemMetricsCollector` is on
`@robota-sdk/agent-plugin/node`.

<!-- doc-example-skip: 2.x/3.0 before/after contrast — the 2.x package is not installed -->

```typescript
// 2.x
import { LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';

// 3.0
import { LoggingPlugin, UsagePlugin } from '@robota-sdk/agent-plugin';
```

**Tool factories** `createFunctionTool` and `createZodFunctionTool` moved to
`@robota-sdk/agent-tools`.

### Removed from `@robota-sdk/agents`

| Removed                                                                                                                      | Instead                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `stream` option in `IAgentConfig`                                                                                            | Call `runStream()`                                                                 |
| `RelayMcpTool`, `IMCPToolConfig`, `IRelayMcpOptions`, `IRelayMcpContext`                                                     | MCP client support is in `@robota-sdk/agent-mcp`; see [MCP](./mcp.md)              |
| `ConversationSession`                                                                                                        | `ConversationHistory` (still in `agent-core`), or a session from `agent-framework` |
| Workflow conversion and validation types (`IWorkflowConfig`, `IWorkflowConverter`, `IWorkflowValidator`, `IWorkflowData`, …) | None in `agent-core`                                                               |
| `IAgentFactory`, `IAgentCreationOptions`, `TAgentCreationMetadata`                                                           | `AgentFactory` and `IAgentFactoryOptions`                                          |
| `IExecutionService`, `IExecutionServiceOptions`, `IToolExecutionService`, `TExecutionMetadata`, `IProviderConfig`            | Internal; no replacement                                                           |
| `IValidationIssue`, `IValidationOptions`, `IValidationResult`, `IConfigValidationResult`, `ValidationSeverity`               | `Validator` and `ISimpleValidationResult`                                          |

### Sessions

`@robota-sdk/sessions` (`ChatInstance`, `SessionManager`, `TemplateManagerAdapter`) has no direct
replacement. Choose by what you need:

- A single agent conversation in your own code: `Robota` from `@robota-sdk/agent-core`, which keeps
  its own history.
- A ready-made agent session with built-in file, shell and web tools, permissions, hooks, context
  compaction and persistence: `InteractiveSession`, `createQuery()` or `createAgentRuntime()` from
  `@robota-sdk/agent-framework`. See [Using the SDK](./sdk.md).
- The session layer on its own: `Session` from `@robota-sdk/agent-session`, with its file-system
  adapters (`NodeSessionStore` and the log, spill and prompt-history files) on
  `@robota-sdk/agent-session/node`.

### Multi-agent work

`@robota-sdk/team` (the assign-task relay tools and templates) was removed. In 3.0, an agent session
delegates work to subagents: `agent-framework` sessions include an `Agent` tool that runs isolated
subagent sessions with their own tools and history, and the `__PRODUCT_CLI_NAME__` CLI exposes the same through
`/agent`. See [Using the SDK](./sdk.md) and the [CLI Reference](./cli.md#background-work-and-automation).

### Upgrade steps

1. Replace the packages as in the [package map](#package-map) and reinstall.
2. Update imports: `@robota-sdk/agents` → `@robota-sdk/agent-core` (plugins from
   `@robota-sdk/agent-plugin`, tool factories from `@robota-sdk/agent-tools`), and the provider
   packages.
3. Rename `GoogleProvider` to `GeminiProvider`.
4. Run `npx tsc --noEmit`; the compiler points at every remaining removed or moved name.
5. Replace `@robota-sdk/sessions` and `@robota-sdk/team` usage as described above.

---

## Between 3.0.0 betas

### Package names from earlier betas

| Earlier beta package                                      | Now                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `@robota-sdk/agent-sdk`                                   | `@robota-sdk/agent-framework`                                                     |
| `@robota-sdk/agent-sessions`                              | `@robota-sdk/agent-session`                                                       |
| `@robota-sdk/agent-executor`                              | `@robota-sdk/agent-executor`                                                      |
| `@robota-sdk/agent-provider-google`                       | `@robota-sdk/agent-provider/gemini`                                               |
| `@robota-sdk/agent-provider-deepseek`                     | `@robota-sdk/agent-provider/deepseek` (`DeepSeekProvider`)                        |
| `@robota-sdk/agent-provider` (all vendors in one package) | `@robota-sdk/agent-provider`, now with one subpath per vendor; see the next table |
| `@robota-sdk/agent-transport-tui`                         | `@robota-sdk/agent-ui-terminal` (`renderApp`, `TuiInteractionChannel`)            |

### Packages merged into subpaths

Fewer packages are published: each former package below is now a subpath of the merged one. Import
paths change; exported names and signatures do not.

| Former packages                                                                                              | Now                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `agent-provider-anthropic`, `-openai`, `-gemini`, `-bytedance`                                               | `@robota-sdk/agent-provider/anthropic`, `/openai`, `/gemini` (`/google` is a deprecated alias), `/bytedance`             |
| `agent-provider-openai-compatible`                                                                           | `@robota-sdk/agent-provider/deepseek`, `/qwen`, `/gemma`; the shared protocol base is `/openai-compatible`               |
| `agent-builtin-providers`                                                                                    | `@robota-sdk/agent-provider/builtin`                                                                                     |
| `agent-file-authority`, `agent-node-lock`, `agent-process`                                                   | `@robota-sdk/agent-os/file-authority`, `/node-lock`, `/process`                                                          |
| `agent-transport-ws`, `-http`, `-mcp`, `-acp`, `-webrtc`, `-link`                                            | `@robota-sdk/agent-transport/ws`, `/http`, `/mcp`, `/acp`, `/webrtc`, `/link`                                            |
| `agent-tool-defaults`                                                                                        | `@robota-sdk/agent-tools/defaults`                                                                                       |
| `agent-capability-pack`, `agent-preset`, `agent-command`, `pack-coding`                                      | `@robota-sdk/agent-product/capability-pack`, `/preset`, `/command`, `/coding`                                            |
| `agent-interface-session`, `-session-mobility`, `-command`, `-execution`, `-analytics`, `-transport`, `-tui` | `@robota-sdk/agent-interface/session`, `/session-mobility`, `/command`, `/execution`, `/analytics`, `/transport`, `/tui` |

The libraries a subpath needs are optional peer dependencies, so install the ones for the subpaths you
import: `@anthropic-ai/sdk`, `openai` or `@google/genai` for a provider, `ws`, `hono` and the MCP or ACP
SDKs for a transport carrier, `koffi` for `agent-os/file-authority` and `agent-os/node-lock`, and
`@robota-sdk/agent-core` for an `agent-interface` family other than `analytics` and `tui`.

### API changes

- **Built-in tools need a working directory.** The ready-made tool instances `readTool`, `writeTool`,
  `editTool`, `globTool`, `grepTool`, `shellTool` and `bashTool` are gone from
  `@robota-sdk/agent-tools`; create them with `createReadTool({ cwd })`, `createWriteTool({ cwd })`,
  `createEditTool({ cwd })`, `createGlobTool({ cwd })`, `createGrepTool({ cwd })`,
  `createShellTool({ cwd })` and `createBashTool({ cwd })`, imported from
  `@robota-sdk/agent-tools/node`. A tool without a root refuses to run.
- **`createDefaultTools()`** is in `@robota-sdk/agent-tools/defaults`.
- **`createSession`** is not exported from `@robota-sdk/agent-framework`; use `InteractiveSession`,
  `createAgentRuntime().createSession(...)` or `createQuery()`.
- **Headless default permission mode.** `createQuery()` and headless sessions default to `default`
  mode: with no approver, a call that would ask is denied. Pass
  `permissionMode: 'bypassPermissions'` explicitly for unattended runs that should not be asked.
- **Node-only helpers** (`canonicalizePath`, `isPathInside`, `CommandExecutor`, `HttpExecutor` and
  the owner-only file helpers) moved from `@robota-sdk/agent-core` to `@robota-sdk/agent-core/node`.
- **MCP.** `IMCPToolConfig` and `IToolFactory.createMCPTool()` were removed from `agent-core`; MCP
  server definitions and the client are in `@robota-sdk/agent-mcp`.
- **ESM only.** `@robota-sdk/agent-cli` and `@robota-sdk/agent-ui-terminal` have no CommonJS entry;
  load them with `import`.
- **Node.js 22.12.0 or newer** is declared by published packages for Node installations; the npm CLI
  and Node adapters require a Node host. Check the released version for its available entries.

---

## Need Help?

- [GitHub Issues](__PROJECT_REPOSITORY_URL__/issues) — report upgrade problems
- [Getting Started](../getting-started/README.md) — start fresh with 3.0 patterns
- [Architecture](./architecture.md) — how the 3.0 packages fit together
