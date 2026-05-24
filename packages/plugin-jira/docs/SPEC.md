# plugin-jira Specification

## Scope

Jira issue tracking plugin for the Robota SDK. Owns the `JiraPlugin` class, the `JiraClient` HTTP adapter, and all Jira-specific domain types. Exposes issue retrieval, JQL-based issue search, issue creation, and project listing as async methods that an agent or direct caller can invoke against the Jira Cloud REST API v3.

## Boundaries

- All plugin lifecycle contracts (`AbstractPlugin`, `IPluginOptions`, `IPluginStats`, `PluginCategory`, `PluginPriority`) are owned by `@robota-sdk/agent-core`. This package only extends those contracts.
- Does not own a tool registry, agent runtime, or conversation management — those belong to higher-layer packages (`@robota-sdk/agents`, `@robota-sdk/agent-sessions`).
- Does not own webhook listeners, real-time subscriptions, or transition/workflow management. Only read and create operations over the REST API are in scope.
- Does not perform credential storage or rotation. Credentials (`baseUrl`, `email`, `apiToken`) are supplied by the caller at construction time.
- Atlassian Document Format (ADF) parsing is limited to plain-text extraction (`extractAdfText`). Rich ADF rendering is not in scope.
- Jira Server (on-premise) is not supported. Only Jira Cloud (`*.atlassian.net`) with API v3 is in scope.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

**Layer structure:**

```
JiraPlugin (src/jira-plugin.ts)
  └─ JiraClient (src/jira-client.ts)
       └─ fetch (global Node.js built-in)
```

**`JiraPlugin`** extends `AbstractPlugin<IJiraPluginOptions, IJiraPluginStats>` from `@robota-sdk/agent-core`. It delegates all network operations to `JiraClient` and maintains in-memory counters (`issuesFetched`, `issuesCreated`) that are merged into the base stats via `getStats()`.

**`JiraClient`** is a stateless HTTP adapter for the Jira Cloud REST API v3. At construction time it computes a Base64-encoded `Authorization: Basic` header from the supplied `email` and `apiToken`. All raw API response shapes (file-private interfaces prefixed with `IRaw`) are mapped to the public domain types defined in `types.ts`. The `extractAdfText` helper recursively extracts plain text from Atlassian Document Format nodes. The `createIssue` implementation performs two HTTP calls: a POST to create the issue and a GET to fetch the canonical representation by key.

**`types.ts`** is the SSOT for all Jira domain interfaces exported from this package.

## Type Ownership

This package is SSOT for the following types. All are exported from the `.` entry point.

| Type                    | Location       | Purpose                                                                                                                       |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `IJiraPluginOptions`    | `src/types.ts` | Constructor options for `JiraPlugin`; extends `IPluginOptions` with `baseUrl`, `email`, `apiToken`, and optional `projectKey` |
| `IJiraIssue`            | `src/types.ts` | Normalized representation of a single Jira issue                                                                              |
| `IJiraCreateIssueInput` | `src/types.ts` | Input shape for issue creation; `issueType` defaults to `"Task"` when omitted                                                 |
| `IJiraProject`          | `src/types.ts` | Normalized representation of a Jira project                                                                                   |
| `IJiraPluginStats`      | `src/types.ts` | Runtime statistics; extends `IPluginStats` with `issuesFetched` and `issuesCreated`                                           |

`IPluginOptions` and `IPluginStats` are owned by `@robota-sdk/agent-core` and extended here; they are not re-exported.

Raw REST response shapes (`IRawIssue`, `IRawIssueFields`, `IRawAdfDocument`, etc.) are file-private to `jira-client.ts` and are not part of the public contract.

## Public API Surface

| Export                  | Kind      | Description                                                                                                                 |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `JiraPlugin`            | class     | Plugin entry point; extends `AbstractPlugin`; provides `getIssue`, `searchIssues`, `createIssue`, `getProjects`, `getStats` |
| `JiraClient`            | class     | Low-level REST adapter; usable independently without the plugin wrapper                                                     |
| `IJiraPluginOptions`    | interface | Constructor options type                                                                                                    |
| `IJiraIssue`            | interface | Issue domain type                                                                                                           |
| `IJiraCreateIssueInput` | interface | Issue creation input type                                                                                                   |
| `IJiraProject`          | interface | Project domain type                                                                                                         |
| `IJiraPluginStats`      | interface | Plugin stats type                                                                                                           |

## Extension Points

- **`IJiraPluginOptions.projectKey`** — Optional default project key. Currently stored on the options object but not auto-applied to queries; callers pass `projectKey` per-call to `createIssue`.
- **`AbstractPlugin.enable()` / `AbstractPlugin.disable()`** — Inherited lifecycle methods allow consumers to toggle the plugin at runtime without re-instantiating it.
- **`JiraClient` (standalone)** — Consumers may instantiate `JiraClient` directly without `JiraPlugin` when they do not need plugin lifecycle semantics (stats, enable/disable, category/priority).
- **`IJiraCreateIssueInput.issueType`** — Optional field that defaults to `"Task"` when omitted; callers can pass any valid Jira issue type name.
- No abstract methods or strategy interfaces are defined. Extension is achieved by subclassing `JiraPlugin` and overriding methods.

## Error Taxonomy

This package does not define custom error classes. All errors are plain `Error` instances thrown from `JiraClient` and propagated unmodified through `JiraPlugin`.

| Source                     | Condition                                          | Message pattern             |
| -------------------------- | -------------------------------------------------- | --------------------------- |
| `JiraClient` (all methods) | Non-2xx HTTP response from Jira API                | `Jira API <status>: <body>` |
| `JiraClient.createIssue`   | POST `/issue` returns non-2xx                      | `Jira API <status>: <body>` |
| `JiraClient.createIssue`   | Subsequent GET for the created key returns non-2xx | `Jira API <status>: <body>` |

All errors propagate to the caller without wrapping. There is no retry logic or fallback behavior.

## Test Strategy

**Current test files:**

| File                                | Description                                                        |
| ----------------------------------- | ------------------------------------------------------------------ |
| `src/__tests__/jira-plugin.test.ts` | Unit tests for `JiraPlugin` with `JiraClient` mocked via `vi.mock` |

**Coverage summary:**

- `JiraPlugin` methods (`getIssue`, `searchIssues`, `createIssue`, `getProjects`) — covered with mock delegation and stats-counter verification.
- `getStats()` override — covered; verifies both base fields and Jira-specific counters.
- `name`, `version`, `category`, `priority`, `enabled` identity assertions — covered.
- `getProjects` stats behavior (issuesFetched/issuesCreated unchanged) — covered.

**Coverage gaps:**

- `JiraClient` is not tested directly (no HTTP-level or integration tests).
- Error propagation paths (HTTP error responses) are not covered.
- ADF text extraction (`extractAdfText`) is not directly tested.
- `IJiraPluginOptions.projectKey` default behavior is not exercised.
- `IJiraCreateIssueInput.issueType` defaulting to `"Task"` is not tested at the plugin layer.
- No integration or E2E tests against the real Jira Cloud API.

## Class Contract Registry

### Inheritance

| Class        | Extends                                                | Location             |
| ------------ | ------------------------------------------------------ | -------------------- |
| `JiraPlugin` | `AbstractPlugin<IJiraPluginOptions, IJiraPluginStats>` | `src/jira-plugin.ts` |

`AbstractPlugin` is owned by `@robota-sdk/agent-core`.

### Interface Implementations

`JiraPlugin` does not directly implement any interfaces beyond what `AbstractPlugin` satisfies. `AbstractPlugin` implements `IPlugin` (owned by `@robota-sdk/agent-core`).

### Overridden Methods

| Method       | Class        | Notes                                                                                       |
| ------------ | ------------ | ------------------------------------------------------------------------------------------- |
| `getStats()` | `JiraPlugin` | Merges base stats from `super.getStats()` with `issuesFetched` and `issuesCreated` counters |

## Configuration

| Option       | Type     | Required | Default     | Description                                                                             |
| ------------ | -------- | -------- | ----------- | --------------------------------------------------------------------------------------- |
| `baseUrl`    | `string` | Yes      | —           | Jira Cloud base URL (e.g., `https://yourorg.atlassian.net`); trailing slash is stripped |
| `email`      | `string` | Yes      | —           | Atlassian account email address; used in Basic auth credentials                         |
| `apiToken`   | `string` | Yes      | —           | Atlassian API token; used in Basic auth credentials                                     |
| `projectKey` | `string` | No       | `undefined` | Optional default project key (stored but not auto-applied by the plugin)                |

Inherited `IPluginOptions` fields (e.g., `enabled`) follow `@robota-sdk/agent-core` defaults.

## Dependencies

| Package                  | Kind       | Purpose                                                                                |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-core` | production | `AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginOptions`, `IPluginStats` |
| `fetch` (global)         | runtime    | Node.js 18+ built-in; no external HTTP library dependency                              |
