# plugin-notion Specification

## Scope

Notion page and database plugin for the Robota SDK. Owns the `NotionPlugin` class, the `NotionClient` HTTP adapter, and all Notion-specific domain types. Exposes page retrieval, block reading, page creation, and full-text page search as async methods that an agent or direct caller can invoke against the Notion REST API v1 (2022-06-28).

## Boundaries

- All plugin lifecycle contracts (`AbstractPlugin`, `IPluginOptions`, `IPluginStats`, `PluginCategory`, `PluginPriority`) are owned by `@robota-sdk/agent-core`. This package only extends those contracts.
- Does not own a tool registry, agent runtime, or conversation management — those belong to higher-layer packages (`@robota-sdk/agents`, `@robota-sdk/agent-sessions`).
- Does not own database querying (filter/sort), block update/delete, comment management, user management, or workspace-level operations. Only page read, page create, block children read, and search are in scope.
- Does not perform credential storage or rotation. The integration token is supplied by the caller at construction time.
- Rich text rendering (beyond plain-text extraction) and nested block recursion are not in scope. `getPageBlocks` returns only the first level of block children.
- `INotionDatabase` is a defined type but no database-specific operations (query, create, update) are implemented. The type is reserved for future use.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

**Layer structure:**

```
NotionPlugin (src/notion-plugin.ts)
  └─ NotionClient (src/notion-client.ts)
       └─ fetch (global Node.js built-in)
```

**`NotionPlugin`** extends `AbstractPlugin<INotionPluginOptions, INotionPluginStats>` from `@robota-sdk/agent-core`. It delegates all network operations to `NotionClient` and maintains in-memory counters (`pagesFetched`, `pagesCreated`, `blocksRead`) that are merged into the base stats via `getStats()`.

**`NotionClient`** is a stateless HTTP adapter for the Notion REST API. It sets the `Notion-Version: 2022-06-28` header on every request for API version pinning. Bearer token auth is applied via the `Authorization` header. Raw API response shapes (file-private interfaces prefixed with `IRaw`) are mapped to the public domain types defined in `types.ts`. The `extractTitleFromProperties` helper resolves a page title from either the `title` or `Name` property key. The `extractPlainText` helper reads `rich_text` arrays from block content objects using the block's `type` field as a dynamic key.

**`types.ts`** is the SSOT for all Notion domain interfaces exported from this package.

## Type Ownership

This package is SSOT for the following types. All are exported from the `.` entry point.

| Type                   | Location       | Purpose                                                                                              |
| ---------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `INotionPluginOptions` | `src/types.ts` | Constructor options for `NotionPlugin`; extends `IPluginOptions` with `token`                        |
| `INotionPage`          | `src/types.ts` | Normalized representation of a Notion page (id, title, url, lastEdited, properties)                  |
| `INotionBlock`         | `src/types.ts` | Normalized representation of a single content block (id, type, plain text)                           |
| `INotionDatabase`      | `src/types.ts` | Normalized representation of a Notion database (id, title, url); no operations currently implemented |
| `INotionPluginStats`   | `src/types.ts` | Runtime statistics; extends `IPluginStats` with `pagesFetched`, `pagesCreated`, and `blocksRead`     |

`IPluginOptions` and `IPluginStats` are owned by `@robota-sdk/agent-core` and extended here; they are not re-exported.

Raw API response shapes (`IRawPage`, `IRawBlock`, `IRawBlocksResponse`, etc.) are file-private to `notion-client.ts` and are not part of the public contract.

## Public API Surface

| Export                 | Kind      | Description                                                                                                                |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `NotionPlugin`         | class     | Plugin entry point; extends `AbstractPlugin`; provides `getPage`, `getPageBlocks`, `createPage`, `searchPages`, `getStats` |
| `NotionClient`         | class     | Low-level REST adapter; usable independently without the plugin wrapper                                                    |
| `INotionPluginOptions` | interface | Constructor options type                                                                                                   |
| `INotionPage`          | interface | Page domain type                                                                                                           |
| `INotionBlock`         | interface | Block domain type                                                                                                          |
| `INotionDatabase`      | interface | Database domain type (reserved; no operations implemented)                                                                 |
| `INotionPluginStats`   | interface | Plugin stats type                                                                                                          |

## Extension Points

- **`AbstractPlugin.enable()` / `AbstractPlugin.disable()`** — Inherited lifecycle methods allow consumers to toggle the plugin at runtime without re-instantiating it. The `disable()`/`enable()` round-trip is covered by tests.
- **`NotionClient` (standalone)** — Consumers may instantiate `NotionClient` directly without `NotionPlugin` when they do not need plugin lifecycle semantics (stats, enable/disable, category/priority).
- **`NotionClient.createPage` `content` parameter** — Optional; when omitted, the page is created with no child blocks. When provided, a single paragraph block is appended.
- No abstract methods or strategy interfaces are defined. Extension is achieved by subclassing `NotionPlugin` and overriding methods.

## Error Taxonomy

This package does not define custom error classes. All errors are plain `Error` instances thrown from `NotionClient` and propagated unmodified through `NotionPlugin`.

| Source                       | Condition                             | Message pattern               |
| ---------------------------- | ------------------------------------- | ----------------------------- |
| `NotionClient` (all methods) | Non-2xx HTTP response from Notion API | `Notion API <status>: <body>` |

All errors propagate to the caller without wrapping. There is no retry logic or fallback behavior.

## Test Strategy

**Current test files:**

| File                                  | Description                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `src/__tests__/notion-plugin.test.ts` | Unit tests for `NotionPlugin` with `NotionClient` mocked via `vi.mock` |

**Coverage summary:**

- `NotionPlugin` methods (`getPage`, `getPageBlocks`, `createPage`, `searchPages`) — covered with mock delegation and stats-counter verification.
- `getStats()` override — covered; verifies base fields plus `pagesFetched`, `pagesCreated`, and `blocksRead` counters.
- `name`, `version`, `category`, `priority`, `enabled` identity assertions — covered.
- `enable()` / `disable()` lifecycle round-trip — covered.
- `blocksRead` increments by the number of blocks returned — covered.
- `pagesFetched` increments by the number of pages returned from `searchPages` — covered.

**Coverage gaps:**

- `NotionClient` is not tested directly (no HTTP-level or integration tests).
- Error propagation paths (non-2xx responses) are not covered.
- `extractTitleFromProperties` fallback between `title` and `Name` property keys is not directly tested.
- `extractPlainText` for block types other than `paragraph` (headings, lists, etc.) is not directly tested.
- `createPage` with no `content` argument (empty children array) is not tested.
- `INotionDatabase` type has no corresponding operation tests.
- No integration or E2E tests against the real Notion API.

## Class Contract Registry

### Inheritance

| Class          | Extends                                                    | Location               |
| -------------- | ---------------------------------------------------------- | ---------------------- |
| `NotionPlugin` | `AbstractPlugin<INotionPluginOptions, INotionPluginStats>` | `src/notion-plugin.ts` |

`AbstractPlugin` is owned by `@robota-sdk/agent-core`.

### Interface Implementations

`NotionPlugin` does not directly implement any interfaces beyond what `AbstractPlugin` satisfies. `AbstractPlugin` implements `IPlugin` (owned by `@robota-sdk/agent-core`).

### Overridden Methods

| Method       | Class          | Notes                                                                                                    |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------------- |
| `getStats()` | `NotionPlugin` | Merges base stats from `super.getStats()` with `pagesFetched`, `pagesCreated`, and `blocksRead` counters |

## Configuration

| Option  | Type     | Required | Default | Description                                                                                 |
| ------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------- |
| `token` | `string` | Yes      | —       | Notion integration token (starts with `secret_`); passed as `Authorization: Bearer <token>` |

Inherited `IPluginOptions` fields (e.g., `enabled`) follow `@robota-sdk/agent-core` defaults.

## Dependencies

| Package                  | Kind       | Purpose                                                                                |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-core` | production | `AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginOptions`, `IPluginStats` |
| `fetch` (global)         | runtime    | Node.js 18+ built-in; no external HTTP library dependency                              |
