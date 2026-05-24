# plugin-linear Specification

## Scope

Linear issue tracking plugin for the Robota SDK. Owns the `LinearPlugin` class, the `LinearClient` HTTP adapter, and all Linear-specific domain types. Exposes issue search, issue creation, single-issue retrieval, and team listing as async methods that an agent or direct caller can invoke against the Linear GraphQL API.

## Boundaries

- All plugin lifecycle contracts (`AbstractPlugin`, `IPluginOptions`, `IPluginStats`, `PluginCategory`, `PluginPriority`) are owned by `@robota-sdk/agent-core`. This package only extends those contracts.
- Does not own a tool registry, agent runtime, or conversation management — those belong to higher-layer packages (`@robota-sdk/agents`, `@robota-sdk/agent-sessions`).
- Does not own a Linear webhook listener or real-time subscription. Only REST/GraphQL polling operations are in scope.
- Does not perform credential storage or rotation. Credentials are supplied by the caller at construction time.
- GraphQL query parsing or schema validation is not in scope. Queries are hardcoded strings sent verbatim to the Linear GraphQL endpoint.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

**Layer structure:**

```
LinearPlugin (src/linear-plugin.ts)
  └─ LinearClient (src/linear-client.ts)
       └─ fetch (global Node.js built-in)
```

**`LinearPlugin`** extends `AbstractPlugin<ILinearPluginOptions, ILinearPluginStats>` from `@robota-sdk/agent-core`. It delegates all network operations to `LinearClient` and maintains in-memory counters (`issuesFetched`, `issuesCreated`) that are merged into the base stats via `getStats()`.

**`LinearClient`** is a stateless HTTP adapter. It encodes all Linear GraphQL queries and mutations as hardcoded strings and maps raw API response shapes (file-private interfaces prefixed with `IRaw`) to the public domain types defined in `types.ts`. The client uses the global `fetch` API (available in Node 18+). Auth is passed via the `Authorization` header using the raw API key.

**`types.ts`** is the SSOT for all Linear domain interfaces exported from this package.

## Type Ownership

This package is SSOT for the following types. All are exported from the `.` entry point.

| Type                      | Location       | Purpose                                                                                              |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `ILinearPluginOptions`    | `src/types.ts` | Constructor options for `LinearPlugin`; extends `IPluginOptions` with `apiKey` and optional `teamId` |
| `ILinearIssue`            | `src/types.ts` | Normalized representation of a single Linear issue                                                   |
| `ILinearTeam`             | `src/types.ts` | Normalized representation of a Linear team                                                           |
| `ILinearCreateIssueInput` | `src/types.ts` | Input shape for issue creation mutations                                                             |
| `ILinearPluginStats`      | `src/types.ts` | Runtime statistics; extends `IPluginStats` with `issuesFetched` and `issuesCreated`                  |

`IPluginOptions` and `IPluginStats` are owned by `@robota-sdk/agent-core` and extended here; they are not re-exported.

Raw GraphQL response shapes (`IRawIssueNode`, `IRawIssueResponse`, etc.) are file-private to `linear-client.ts` and are not part of the public contract.

## Public API Surface

| Export                    | Kind      | Description                                                                                                              |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `LinearPlugin`            | class     | Plugin entry point; extends `AbstractPlugin`; provides `getIssue`, `searchIssues`, `createIssue`, `getTeams`, `getStats` |
| `LinearClient`            | class     | Low-level GraphQL adapter; usable independently without the plugin wrapper                                               |
| `ILinearPluginOptions`    | interface | Constructor options type                                                                                                 |
| `ILinearIssue`            | interface | Issue domain type                                                                                                        |
| `ILinearTeam`             | interface | Team domain type                                                                                                         |
| `ILinearCreateIssueInput` | interface | Issue creation input type                                                                                                |
| `ILinearPluginStats`      | interface | Plugin stats type                                                                                                        |

## Extension Points

- **`ILinearPluginOptions.teamId`** — Optional default team ID. Currently stored on the options object but not auto-applied to queries; callers pass `teamId` per-call to `searchIssues`.
- **`AbstractPlugin.enable()` / `AbstractPlugin.disable()`** — Inherited lifecycle methods allow consumers to toggle the plugin at runtime without re-instantiating it.
- **`LinearClient` (standalone)** — Consumers may instantiate `LinearClient` directly without `LinearPlugin` when they do not need plugin lifecycle semantics (stats, enable/disable, category/priority).
- No abstract methods or strategy interfaces are defined. Extension is achieved by subclassing `LinearPlugin` and overriding methods.

## Error Taxonomy

This package does not define custom error classes. All errors are plain `Error` instances thrown from `LinearClient` and propagated unmodified through `LinearPlugin`.

| Source                        | Condition                                          | Message pattern                                              |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `LinearClient.graphqlRequest` | Non-2xx HTTP response from Linear API              | `Linear HTTP <status>: <body>`                               |
| `LinearClient.graphqlRequest` | GraphQL `errors` array present in response         | `Linear GraphQL error: <messages joined by ', '>`            |
| `LinearClient.createIssue`    | Mutation returned `success: false` or `null` issue | `Linear issueCreate mutation did not return a created issue` |

All errors propagate to the caller without wrapping. There is no retry logic or fallback behavior.

## Test Strategy

**Current test files:**

| File                                  | Description                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `src/__tests__/linear-plugin.test.ts` | Unit tests for `LinearPlugin` with `LinearClient` mocked via `vi.mock` |

**Coverage summary:**

- `LinearPlugin` methods (`getIssue`, `searchIssues`, `createIssue`, `getTeams`) — covered with mock delegation and stats-counter verification.
- `getStats()` override — covered; verifies both base fields and Linear-specific counters.
- `name`, `version`, `category`, `priority`, `enabled` identity assertions — covered.

**Coverage gaps:**

- `LinearClient` is not tested directly (no HTTP-level or integration tests).
- Error propagation paths (HTTP error, GraphQL error, mutation failure) are not covered.
- `ILinearPluginOptions.teamId` behavior is not exercised.
- No integration or E2E tests against the real Linear API.

## Class Contract Registry

### Inheritance

| Class          | Extends                                                    | Location               |
| -------------- | ---------------------------------------------------------- | ---------------------- |
| `LinearPlugin` | `AbstractPlugin<ILinearPluginOptions, ILinearPluginStats>` | `src/linear-plugin.ts` |

`AbstractPlugin` is owned by `@robota-sdk/agent-core`.

### Interface Implementations

`LinearPlugin` does not directly implement any interfaces beyond what `AbstractPlugin` satisfies. `AbstractPlugin` implements `IPlugin` (owned by `@robota-sdk/agent-core`).

### Overridden Methods

| Method       | Class          | Notes                                                                                       |
| ------------ | -------------- | ------------------------------------------------------------------------------------------- |
| `getStats()` | `LinearPlugin` | Merges base stats from `super.getStats()` with `issuesFetched` and `issuesCreated` counters |

## Configuration

| Option   | Type     | Required | Default     | Description                                                             |
| -------- | -------- | -------- | ----------- | ----------------------------------------------------------------------- |
| `apiKey` | `string` | Yes      | —           | Linear API key; passed as bare `Authorization` header value             |
| `teamId` | `string` | No       | `undefined` | Optional default team scope (stored but not auto-applied by the plugin) |

Inherited `IPluginOptions` fields (e.g., `enabled`) follow `@robota-sdk/agent-core` defaults.

## Dependencies

| Package                  | Kind       | Purpose                                                                                |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-core` | production | `AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginOptions`, `IPluginStats` |
| `fetch` (global)         | runtime    | Node.js 18+ built-in; no external HTTP library dependency                              |
