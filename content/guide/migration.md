---
title: Migrating to 3.x
description: Upgrade from the Robota SDK 2.x packages, earlier 3.0 betas and the packages that are now subpaths of merged ones.
---

# Migrating to 3.x

SDK packages version independently, so read each package's version from your lockfile or the registry
instead of assuming one number for the whole SDK. [Architecture](./architecture.md) lists the current
packages.

This guide has three parts: moving from the 2.x packages, changes since the 3.0 betas, and the packages
that are now subpaths of merged ones.

---

## From 2.x

### Package map

The 2.x packages had short names; 3.x packages are named by role.

| 2.x package                             | 3.x package                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agents`                    | `@robota-sdk/agent-core`, plus `@robota-sdk/agent-plugin` and `@robota-sdk/agent-tools` (see below) |
| `@robota-sdk/openai`                    | `@robota-sdk/agent-provider/openai`                                                                 |
| `@robota-sdk/anthropic`                 | `@robota-sdk/agent-provider/anthropic`                                                              |
| `@robota-sdk/google`                    | `@robota-sdk/agent-provider/gemini`                                                                 |
| `@robota-sdk/sessions`                  | Removed; see [Sessions](#sessions)                                                                  |
| `@robota-sdk/team`                      | Removed; see [Multi-agent work](#multi-agent-work)                                                  |
| `@robota-sdk/core`, `@robota-sdk/tools` | Already deprecated in 2.x in favor of `@robota-sdk/agents`; migrate as for `agents`                 |

```diff
-  "@robota-sdk/agents": "^2.0.9",
-  "@robota-sdk/openai": "^2.0.9",
-  "@robota-sdk/anthropic": "^2.0.9",
-  "@robota-sdk/google": "^2.0.9",
+  "@robota-sdk/agent-core": "^3.3.0",
+  "@robota-sdk/agent-plugin": "^3.2.3",
+  "@robota-sdk/agent-provider": "^3.3.1",
+  "openai": "^6.0.0",
+  "@anthropic-ai/sdk": "^0.114.0",
+  "@google/genai": "^1.52.0",
```

`@robota-sdk/agent-provider` has no root export: each vendor is a subpath, and the vendor SDKs
(`openai`, `@anthropic-ai/sdk`, `@google/genai`) are optional peers that your application installs for
the subpaths it imports.

### What stays the same

Most of the 2.x `@robota-sdk/agents` API is in `@robota-sdk/agent-core` under the same names:
`Robota`, `AbstractAIProvider`, `AbstractPlugin`, `PluginCategory`, `PluginPriority`,
`EventEmitterPlugin`, `FunctionTool`, `ToolRegistry`, `AgentFactory`, `AgentTemplates`,
`ConversationHistory`, the error classes, and the `I*`/`T*` types such as `IAgentConfig`,
`IToolSchema` and `TUniversalMessage`. `ConversationAgent` is the same class as `Robota` under its
neutral name. The constructor takes the same core options
(`name`, `aiProviders`, `defaultModel`, `tools`, `plugins`, `systemMessage`), and `run()`,
`runStream()` and `setModel()` work as before.

The OpenAI and Anthropic providers keep their exports (`OpenAIProvider`, `IOpenAIProviderOptions`,
`AnthropicProvider`, `IAnthropicProviderOptions`, `createAnthropicProvider`); only the import path
changes:

<!-- doc-example-skip: 2.x/3.x before/after contrast — the 2.x packages are not installed -->

```typescript
// 2.x
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

// 3.x
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
```

### Renamed: the Google provider

| 2.x (`@robota-sdk/google`)   | 3.x (`@robota-sdk/agent-provider/gemini`) |
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

<!-- doc-example-skip: 2.x/3.x before/after contrast — the 2.x package is not installed -->

```typescript
// 2.x
import { LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';

// 3.x
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

`@robota-sdk/team` (the assign-task relay tools and templates) was removed. In 3.x, an agent session
delegates work to subagents: `agent-framework` sessions include an `Agent` tool that runs isolated
subagent sessions with their own tools and history, and the `__PRODUCT_CLI_NAME__` CLI exposes the same through
`/agent`. See [Using the SDK](./sdk.md) and the [CLI Reference](./cli.md#background-work-and-automation).

### Upgrade steps

1. Replace the packages as in the [package map](#package-map) and reinstall, adding the vendor SDKs
   for the provider subpaths you import.
2. Update imports: `@robota-sdk/agents` → `@robota-sdk/agent-core` (plugins from
   `@robota-sdk/agent-plugin`, tool factories from `@robota-sdk/agent-tools`), and the provider
   packages → subpaths of `@robota-sdk/agent-provider`.
3. Rename `GoogleProvider` to `GeminiProvider`.
4. Run `npx tsc --noEmit`; the compiler points at every remaining removed or moved name.
5. Replace `@robota-sdk/sessions` and `@robota-sdk/team` usage as described above.

---

## From the 3.0 betas

### Package names from earlier betas

| Earlier beta package                                      | Now                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `@robota-sdk/agent-sdk`                                   | `@robota-sdk/agent-framework`                                                    |
| `@robota-sdk/agent-sessions`                              | `@robota-sdk/agent-session`                                                      |
| `@robota-sdk/agent-provider-google`                       | `@robota-sdk/agent-provider/gemini`                                              |
| `@robota-sdk/agent-provider-deepseek`                     | `@robota-sdk/agent-provider/deepseek` (`DeepSeekProvider`)                       |
| `@robota-sdk/agent-provider` (all vendors in one package) | `@robota-sdk/agent-provider`, now with no root export and one subpath per vendor |
| `@robota-sdk/agent-transport-tui`                         | `@robota-sdk/agent-ui-terminal` (`renderApp`, `TuiInteractionChannel`)           |

### API changes

- **Built-in tools need a working directory.** The ready-made tool instances `readTool`, `writeTool`,
  `editTool`, `globTool`, `grepTool`, `shellTool` and `bashTool` are gone from
  `@robota-sdk/agent-tools`; create them with `createReadTool({ cwd })`, `createWriteTool({ cwd })`,
  `createEditTool({ cwd })`, `createGlobTool({ cwd })`, `createGrepTool({ cwd })`,
  `createShellTool({ cwd })` and `createBashTool({ cwd })`, imported from
  `@robota-sdk/agent-tools/node`. A tool without a root refuses to run.
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
- **Node.js 22.12.0 or newer.** Every published package declares `engines.node` as `>=22.12.0`.

---

## Packages merged into subpaths

Fewer packages are published: each former package below is now a subpath of the merged one. Import
paths change; exported names and signatures do not. A merged package ships its subpaths from the
version shown, and a bundle that imports one subpath contains no other subpath's code.

| Former packages                                                                                              | Now                                                                                                                      | From  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| `agent-provider-anthropic`, `-openai`, `-gemini`, `-bytedance`                                               | `@robota-sdk/agent-provider/anthropic`, `/openai`, `/gemini` (`/google` is a compatibility alias), `/bytedance`          | 3.3.0 |
| `agent-provider-openai-compatible`                                                                           | `@robota-sdk/agent-provider/deepseek`, `/qwen`, `/gemma`; the shared protocol base is `/openai-compatible`               | 3.3.0 |
| `agent-builtin-providers`                                                                                    | `@robota-sdk/agent-provider/builtin`                                                                                     | 3.3.0 |
| `agent-file-authority`, `agent-node-lock`, `agent-process`                                                   | `@robota-sdk/agent-os/file-authority` (and `/file-authority/testing`), `/node-lock`, `/process`                          | 3.3.0 |
| `agent-transport-ws`, `-http`, `-mcp`, `-acp`, `-webrtc`, `-link`                                            | `@robota-sdk/agent-transport/ws`, `/http`, `/mcp`, `/acp`, `/webrtc`, `/link`                                            | 3.4.0 |
| `agent-transport-webrtc-web`                                                                                 | No package: the browser client is part of the `apps/agent-web` application                                               | —     |
| `agent-tool-defaults`                                                                                        | `@robota-sdk/agent-tools/defaults`                                                                                       | 3.3.0 |
| `agent-capability-pack`, `agent-preset`, `agent-command`, `pack-coding`                                      | `@robota-sdk/agent-product/capability-pack`, `/preset`, `/command`, `/coding`                                            | 3.3.0 |
| `agent-interface-session`, `-session-mobility`, `-command`, `-execution`, `-analytics`, `-transport`, `-tui` | `@robota-sdk/agent-interface/session`, `/session-mobility`, `/command`, `/execution`, `/analytics`, `/transport`, `/tui` | 3.3.0 |

`@robota-sdk/agent-provider`, `@robota-sdk/agent-os` and `@robota-sdk/agent-interface` have no root
export. `@robota-sdk/agent-transport` keeps its root, `/client` and `/node` entries beside the carrier
subpaths, and `@robota-sdk/agent-product` keeps its root export beside its subpaths.

The libraries a subpath needs are optional peer dependencies, so install the ones for the subpaths you
import: `@anthropic-ai/sdk`, `openai` or `@google/genai` for a provider; `ws`, `hono`, the MCP or ACP
SDKs and, for `webrtc` and `link`, `@robota-sdk/agent-remote-pairing` and `@robota-sdk/agent-keyring` for a
transport carrier; `koffi` for `agent-os/file-authority` and `agent-os/node-lock`; and
`@robota-sdk/agent-core` for an `agent-interface` family other than `analytics` and `tui`.

---

## Need Help?

- [GitHub Issues](__PROJECT_REPOSITORY_URL__/issues) — report upgrade problems
- [Getting Started](../getting-started/README.md) — start fresh with 3.x patterns
- [Architecture](./architecture.md) — how the 3.x packages fit together
