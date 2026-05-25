# @robota-sdk/plugin-slack — Package Specification

## 1. Scope

`@robota-sdk/plugin-slack` owns the integration layer between the Robota agent runtime and the Slack Web API. It provides a plugin that posts messages to Slack channels, reads channel history, and uploads text files so agents can notify and query Slack during a session. The package owns the Slack API client wrapper (`SlackClient`), the plugin orchestration class (`SlackPlugin`), and all SSOT types that describe Slack domain objects within the Robota SDK.

## 2. Boundaries

This package does NOT own:

- **Plugin lifecycle management and registration**: owned by `@robota-sdk/agent-core` (`AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginOptions`, `IPluginStats`).
- **Agent runtime execution**: owned by `@robota-sdk/agent-core`.
- **Authentication token storage or rotation**: callers supply the Bot Token directly; secret management is the consumer's responsibility.
- **Slack event subscriptions or real-time messaging (RTM/Socket Mode)**: this package only performs synchronous REST calls to the Slack Web API.
- **Block Kit message composition**: the `postMessage` method sends plain text only; rich Block Kit payloads are the consumer's responsibility.
- **Slack workspace or channel management** (creating channels, inviting users, etc.): out of scope.
- **Binary file uploads** (images, PDFs): only text file uploads via the v2 upload flow are supported.

## 3. Architecture Overview

```
Consumer (agent or script)
        │
        ▼
  SlackPlugin                     ← AbstractPlugin subclass; exposes domain methods,
        │                           tracks call/stats counters, manages default channel
        │ delegates all HTTP to
        ▼
  SlackClient                     ← Thin fetch wrapper; sends authenticated requests to
        │                           https://slack.com/api and maps raw responses to
        │                           SSOT domain types
        ▼
  Slack Web API
```

**Layer responsibilities:**

| Layer         | Responsibility                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `SlackPlugin` | Plugin contract, stats tracking, default-channel routing (`postToDefault`), delegation to `SlackClient`  |
| `SlackClient` | HTTP transport, request construction, response mapping, two-phase file upload (v2 flow), error surfacing |
| `types.ts`    | SSOT domain interfaces (`ISlackMessage`, `ISlackPostResult`) and plugin configuration types              |

Internal raw shapes (`IRawPostMessageResponse`, `IRawHistoryMessage`, `IRawHistoryResponse`, `IRawUploadUrlResponse`, `IRawCompleteUploadResponse`) are private to `SlackClient` and are not exported.

**File upload flow (v2):** `SlackClient.uploadText` implements the three-step Slack v2 upload protocol:

1. `files.getUploadURLExternal` — obtain a pre-signed upload URL and `file_id`.
2. HTTP `POST` to the pre-signed URL with the file content.
3. `files.completeUploadExternal` — finalize the upload and associate it with the channel.

## 4. Type Ownership

These are the SSOT types defined by this package. Consumers must import them from `@robota-sdk/plugin-slack` rather than redefining equivalent shapes.

| Type                  | Location       | Purpose                                                                                                |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `ISlackPluginOptions` | `src/types.ts` | Configuration passed to `new SlackPlugin()`; extends `IPluginOptions` from agent-core                  |
| `ISlackMessage`       | `src/types.ts` | Normalized representation of a single Slack channel message (ts, channel, text, username?)             |
| `ISlackPostResult`    | `src/types.ts` | Result returned after posting a message (ok, ts, channel)                                              |
| `ISlackPluginStats`   | `src/types.ts` | Runtime statistics for `SlackPlugin`; extends `IPluginStats` with `messagesSent` and `messagesFetched` |

## 5. Public API Surface

| Export                | Kind        | Description                                                                                                                            |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SlackPlugin`         | `class`     | Plugin that exposes `postMessage`, `postToDefault`, and `getHistory`; extends `AbstractPlugin<ISlackPluginOptions, ISlackPluginStats>` |
| `SlackClient`         | `class`     | Low-level Slack Web API wrapper; can be used independently of the plugin                                                               |
| `ISlackPluginOptions` | `interface` | Options for constructing `SlackPlugin`                                                                                                 |
| `ISlackMessage`       | `interface` | Normalized Slack message shape                                                                                                         |
| `ISlackPostResult`    | `interface` | Result of a successful `postMessage` call                                                                                              |
| `ISlackPluginStats`   | `interface` | Stats object returned by `SlackPlugin.getStats()`                                                                                      |

### `SlackPlugin` method signatures

```typescript
postMessage(channel: string, text: string, options?: { username?: string; iconEmoji?: string }): Promise<ISlackPostResult>
postToDefault(text: string, options?: { username?: string; iconEmoji?: string }): Promise<ISlackPostResult>
getHistory(channel: string, limit?: number): Promise<ISlackMessage[]>
getStats(): ISlackPluginStats
```

### `SlackClient` method signatures

```typescript
postMessage(channel: string, text: string, options?: { username?: string; iconEmoji?: string }): Promise<ISlackPostResult>
getChannelHistory(channel: string, limit?: number): Promise<ISlackMessage[]>
uploadText(channel: string, filename: string, content: string, title?: string): Promise<void>
```

## 6. Extension Points

**Subclassing `SlackPlugin`**: Consumers may extend `SlackPlugin` to override any lifecycle hook inherited from `AbstractPlugin`. Common patterns include `beforeRun` / `afterRun` (to post agent start/finish notifications) and `onError` (to send error alerts to a Slack channel).

```typescript
class NotifyingSlackPlugin extends SlackPlugin {
  override async afterRun(input: string, response: string): Promise<void> {
    await this.postToDefault(`Agent finished: ${response.slice(0, 100)}`);
  }
  override async onError(error: Error): Promise<void> {
    await this.postToDefault(`Agent error: ${error.message}`);
  }
}
```

**`postToDefault` convenience method**: Consumers can configure a `defaultChannel` in `ISlackPluginOptions` and call `postToDefault` throughout the codebase without repeating the channel name.

**`SlackClient` direct use**: `SlackClient` is exported independently and can be used outside the plugin pattern for programmatic Slack interactions that do not require the agent plugin lifecycle.

## 7. Error Taxonomy

This package does not define custom error classes. All errors are thrown as native `Error` instances with structured messages.

| Error Pattern                                             | Source                      | Description                                                                                        |
| --------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `Slack HTTP ${status}: ${body}`                           | `SlackClient`               | HTTP transport failure; the response status code and raw body are included                         |
| `Slack API error: ${data.error}`                          | `SlackClient`               | Slack Web API application-level error (HTTP 200 but `ok: false`); the Slack error code is included |
| `Slack API error (getUploadURLExternal): ${data.error}`   | `SlackClient.uploadText`    | Application error during step 1 of the v2 file upload flow                                         |
| `Slack upload PUT failed with HTTP ${status}`             | `SlackClient.uploadText`    | HTTP failure during step 2 (PUT to pre-signed URL)                                                 |
| `Slack API error (completeUploadExternal): ${data.error}` | `SlackClient.uploadText`    | Application error during step 3 of the v2 file upload flow                                         |
| `SlackPlugin: no defaultChannel configured`               | `SlackPlugin.postToDefault` | `postToDefault` called but `ISlackPluginOptions.defaultChannel` was not set                        |

**Recovery guidance:**

- `4xx` HTTP errors indicate token or permission issues; verify the Bot Token scopes (`chat:write`, `channels:history`, `files:write`).
- Slack API application errors (e.g., `channel_not_found`, `not_in_channel`) require correcting the channel ID or bot membership.
- `no defaultChannel configured` is a programming error; set `defaultChannel` in options before calling `postToDefault`.

## 8. Test Strategy

**Current test file:**

| File                                 | Description                                                               |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `src/__tests__/slack-plugin.test.ts` | Unit tests for `SlackPlugin`; `SlackClient` is fully mocked via `vi.mock` |

**Coverage scenarios:**

- Plugin initialization: verifies `name`, `version`, `category` (`NOTIFICATION`), `priority` (`NORMAL`), `enabled` state.
- `postMessage`: delegates to `SlackClient.postMessage`, increments `messagesSent` and `calls`.
- `postToDefault`: uses configured `defaultChannel`, delegates to `postMessage`.
- `postToDefault` (no channel): throws `'SlackPlugin: no defaultChannel configured'`.
- `getHistory`: delegates to `SlackClient.getChannelHistory`, increments `messagesFetched` by result count.
- `getStats`: verifies merged base stats (`enabled`, `calls`, `errors`, `moduleEventsReceived`, `lastActivity`) plus Slack-specific fields.

**Coverage gaps:**

- `SlackClient` is not tested directly (HTTP transport, raw response mapping, three-step upload flow).
- No integration tests against the real Slack Web API.
- `onError` and other lifecycle hook override patterns are not tested.
- `uploadText` is exposed on `SlackClient` but there is no corresponding method on `SlackPlugin`; this gap is not covered by tests.

## 9. Class Contract Registry

| Class         | Extends                                                  | Implements                                                                                                              | Cross-package ports                                                                         |
| ------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SlackPlugin` | `AbstractPlugin<ISlackPluginOptions, ISlackPluginStats>` | `IPluginContract<ISlackPluginOptions, ISlackPluginStats>` (via `AbstractPlugin`), `IPluginHooks` (via `AbstractPlugin`) | Consumes `AbstractPlugin`, `PluginCategory`, `PluginPriority` from `@robota-sdk/agent-core` |
| `SlackClient` | —                                                        | —                                                                                                                       | Standalone class; no external contracts                                                     |

---

## Optional Sections

### Dependencies

| Package                  | Type         | Purpose                                                                                         |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-core` | `dependency` | Provides `AbstractPlugin`, `PluginCategory`, `PluginPriority`, `IPluginOptions`, `IPluginStats` |

### Configuration

| Option           | Type             | Required | Default                       | Description                                                                                          |
| ---------------- | ---------------- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `token`          | `string`         | Yes      | —                             | Slack Bot Token (`xoxb-...`) with `chat:write` and `channels:history` scopes                         |
| `defaultChannel` | `string`         | No       | —                             | Default channel ID or name used by `postToDefault()`; throws if unset when `postToDefault` is called |
| `enabled`        | `boolean`        | No       | `true`                        | Inherited from `IPluginOptions`; controls whether the plugin is active                               |
| `category`       | `PluginCategory` | No       | `PluginCategory.NOTIFICATION` | Inherited from `IPluginOptions`; overrides the plugin category                                       |
| `priority`       | `number`         | No       | `PluginPriority.NORMAL`       | Inherited from `IPluginOptions`; controls plugin execution order                                     |
