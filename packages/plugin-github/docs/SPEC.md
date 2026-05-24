# @robota-sdk/plugin-github — Package Specification

## 1. Scope

`@robota-sdk/plugin-github` owns the integration layer between the Robota agent runtime and the GitHub REST API. It provides a plugin that fetches GitHub issues and pull requests so agents can reference live repository context during a session. The package owns the GitHub API client wrapper (`GitHubClient`), the plugin orchestration class (`GitHubPlugin`), and all SSOT types that describe GitHub domain objects within the Robota SDK.

## 2. Boundaries

This package does NOT own:

- **Plugin lifecycle management and registration**: owned by `@robota-sdk/agent-core` (`AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginOptions`, `IPluginStats`, `IPluginExecutionContext`).
- **Agent runtime execution**: owned by `@robota-sdk/agent-core`.
- **Authentication token storage or rotation**: callers supply the token directly; secret management is the consumer's responsibility.
- **GitHub webhook ingestion or streaming events**: this package only performs synchronous REST reads via `fetch`.
- **Pagination beyond `limit`**: the `listOpenIssues` method accepts a `limit` parameter but does not implement cursor-based pagination.
- **Write operations** (creating/updating issues or PRs): out of scope; only read operations are supported.

## 3. Architecture Overview

```
Consumer (agent or script)
        │
        ▼
  GitHubPlugin                    ← AbstractPlugin subclass; exposes domain methods,
        │                           tracks call/stats counters, manages lifecycle hooks
        │ delegates all HTTP to
        ▼
  GitHubClient                    ← Thin fetch wrapper; sends authenticated requests to
        │                           https://api.github.com and maps raw API responses to
        │                           SSOT domain types
        ▼
  GitHub REST API (v2022-11-28)
```

**Layer responsibilities:**

| Layer          | Responsibility                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `GitHubPlugin` | Plugin contract, stats tracking, lifecycle hooks (`beforeExecution`), delegation to `GitHubClient` |
| `GitHubClient` | HTTP transport, request construction, response mapping, error surfacing                            |
| `types.ts`     | SSOT domain interfaces (`IGitHubIssue`, `IGitHubPR`) and plugin configuration types                |

Internal raw shapes (`IRawLabel`, `IRawIssue`, `IRawPR`) are private to `GitHubClient` and are not exported.

## 4. Type Ownership

These are the SSOT types defined by this package. Consumers must import them from `@robota-sdk/plugin-github` rather than redefining equivalent shapes.

| Type                   | Location       | Purpose                                                                                                                            |
| ---------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `IGitHubPluginOptions` | `src/types.ts` | Configuration passed to `new GitHubPlugin()`; extends `IPluginOptions` from agent-core                                             |
| `IGitHubIssue`         | `src/types.ts` | Normalized representation of a GitHub issue (number, title, body, state, labels, url)                                              |
| `IGitHubPR`            | `src/types.ts` | Normalized representation of a GitHub pull request (number, title, body, state, headBranch, baseBranch, url, additions, deletions) |
| `IGitHubPluginStats`   | `src/types.ts` | Runtime statistics for `GitHubPlugin`; extends `IPluginStats` with `issuesFetched` and `prsFetched`                                |

## 5. Public API Surface

| Export                 | Kind        | Description                                                                                                                       |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GitHubPlugin`         | `class`     | Plugin that exposes `getIssue`, `getPR`, and `listOpenIssues`; extends `AbstractPlugin<IGitHubPluginOptions, IGitHubPluginStats>` |
| `GitHubClient`         | `class`     | Low-level GitHub REST API wrapper; can be used independently of the plugin                                                        |
| `IGitHubPluginOptions` | `interface` | Options for constructing `GitHubPlugin`                                                                                           |
| `IGitHubIssue`         | `interface` | Normalized GitHub issue shape                                                                                                     |
| `IGitHubPR`            | `interface` | Normalized GitHub pull request shape                                                                                              |
| `IGitHubPluginStats`   | `interface` | Stats object returned by `GitHubPlugin.getStats()`                                                                                |

### `GitHubPlugin` method signatures

```typescript
getIssue(owner: string, repo: string, number: number): Promise<IGitHubIssue>
getPR(owner: string, repo: string, number: number): Promise<IGitHubPR>
listOpenIssues(owner: string, repo: string, limit?: number): Promise<IGitHubIssue[]>
getStats(): IGitHubPluginStats
```

### `GitHubClient` method signatures

```typescript
getIssue(owner: string, repo: string, number: number): Promise<IGitHubIssue>
getPR(owner: string, repo: string, number: number): Promise<IGitHubPR>
listOpenIssues(owner: string, repo: string, limit?: number): Promise<IGitHubIssue[]>
```

## 6. Extension Points

**Subclassing `GitHubPlugin`**: Consumers may extend `GitHubPlugin` to inject GitHub context into the agent system prompt by overriding the `beforeExecution` lifecycle hook. The base implementation calls `super.beforeExecution(context)` and is a no-op; subclasses add enrichment logic there.

```typescript
class MyGitHubPlugin extends GitHubPlugin {
  override async beforeExecution(context: IPluginExecutionContext): Promise<void> {
    await super.beforeExecution(context);
    // Inject issue/PR summaries into context here
  }
}
```

Other lifecycle hooks inherited from `AbstractPlugin` (`beforeRun`, `afterRun`, `onError`, etc.) are also available for override but are not implemented by `GitHubPlugin` itself.

## 7. Error Taxonomy

This package does not define custom error classes. All errors are thrown as native `Error` instances with structured messages.

| Error Pattern                                       | Source         | Description                                                                                    |
| --------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `GitHub API ${status}: ${body}`                     | `GitHubClient` | HTTP-level failure; the response status code and raw response body are included in the message |
| `GitHub API ${status}: ${body}` (on listOpenIssues) | `GitHubClient` | Same pattern for list endpoint failures                                                        |

**Recovery guidance:**

- `4xx` errors (e.g., 401, 403, 404) indicate credential or access issues; the token or `owner`/`repo` parameters should be verified.
- `5xx` errors are transient; consumers may retry with back-off.
- No automatic retry is implemented; retry logic is the consumer's responsibility.

## 8. Test Strategy

**Current test file:**

| File                                  | Description                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/__tests__/github-plugin.test.ts` | Unit tests for `GitHubPlugin`; `GitHubClient` is fully mocked via `vi.mock` |

**Coverage scenarios:**

- Plugin initialization: verifies `name`, `version`, `category` (`CUSTOM`), `priority` (`NORMAL`), `enabled` state.
- `getIssue`: delegates to `GitHubClient.getIssue`, increments `issuesFetched` and `calls`.
- `getPR`: delegates to `GitHubClient.getPR`, increments `prsFetched` and `calls`.
- `listOpenIssues`: delegates to `GitHubClient.listOpenIssues`, increments `issuesFetched` by result count.
- `getStats`: verifies merged base stats (`enabled`, `calls`, `errors`, `moduleEventsReceived`, `lastActivity`) plus GitHub-specific fields.
- `enable` / `disable`: toggles `enabled` state and reflects it in `getStats`.

**Coverage gaps:**

- `GitHubClient` is not tested directly (HTTP-level, raw response mapping, PR pulls filtering).
- No integration tests against the real GitHub API.
- `beforeExecution` hook override pattern is not tested.

## 9. Class Contract Registry

| Class          | Extends                                                    | Implements                                                                                                                | Cross-package ports                                                                                                    |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GitHubPlugin` | `AbstractPlugin<IGitHubPluginOptions, IGitHubPluginStats>` | `IPluginContract<IGitHubPluginOptions, IGitHubPluginStats>` (via `AbstractPlugin`), `IPluginHooks` (via `AbstractPlugin`) | Consumes `AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginExecutionContext` from `@robota-sdk/agent-core` |
| `GitHubClient` | —                                                          | —                                                                                                                         | Standalone class; no external contracts                                                                                |

---

## Optional Sections

### Dependencies

| Package                  | Type         | Purpose                                                                                                                    |
| ------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-core` | `dependency` | Provides `AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginOptions`, `IPluginStats`, `IPluginExecutionContext` |

### Configuration

| Option     | Type             | Required | Default                 | Description                                                                               |
| ---------- | ---------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `token`    | `string`         | Yes      | —                       | GitHub Personal Access Token with `repo` or `public_repo` scope                           |
| `owner`    | `string`         | No       | —                       | Default repository owner (not used by current implementation; available for subclass use) |
| `repo`     | `string`         | No       | —                       | Default repository name (not used by current implementation; available for subclass use)  |
| `enabled`  | `boolean`        | No       | `true`                  | Inherited from `IPluginOptions`; controls whether the plugin is active                    |
| `category` | `PluginCategory` | No       | `PluginCategory.CUSTOM` | Inherited from `IPluginOptions`; overrides the plugin category                            |
| `priority` | `number`         | No       | `PluginPriority.NORMAL` | Inherited from `IPluginOptions`; controls plugin execution order                          |
