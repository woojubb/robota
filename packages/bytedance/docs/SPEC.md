# ByteDance Specification

## Scope

Owns ByteDance and BytePlus media provider integration for Robota SDK. Implements `IVideoGenerationProvider` from `@robota-sdk/agents` for Seedance video generation, including video task creation, polling, and cancellation via the BytePlus/ModelArk HTTP API.

## Boundaries

- Does not own generic media contracts (`IVideoGenerationProvider`, `IVideoJobSnapshot`, `TProviderMediaResult`); those belong to `@robota-sdk/agents`.
- Does not own DAG contracts or agent execution contracts.
- Provider-specific request/response mapping and HTTP transport are fully contained in this package.
- No direct dependency on other provider packages (`openai`, `anthropic`, `google`).

## Architecture Overview

Single-class provider architecture. `BytedanceProvider` handles all HTTP communication with the BytePlus API, maps upstream responses to the canonical `TProviderMediaResult` shape, and normalizes status strings to the standard `IVideoJobSnapshot` status enum. Content payload construction supports text prompts and inline/URI image inputs.

## Type Ownership

This package is SSOT for:

- `IBytedanceProviderOptions` -- provider configuration (API key, base URL, path templates, timeout).
- `IBytedanceCreateVideoTaskRequest` / `IBytedanceCreateVideoTaskResponse` -- upstream request/response shapes.
- `IBytedanceVideoTaskResponse` -- upstream task polling response.
- `IBytedanceApiErrorResponse` -- upstream error body shape.
- `TBytedanceTaskContent` (`IBytedanceTaskContentText | IBytedanceTaskContentImageUrl`) -- content payload union.

## Public API Surface

| Export | Kind | Description |
|--------|------|-------------|
| `BytedanceProvider` | class | `IVideoGenerationProvider` implementation for BytePlus/ModelArk |
| `IBytedanceProviderOptions` | interface | Constructor configuration |
| `TBytedanceTaskContent` | type | Content payload discriminated union |
| `IBytedanceCreateVideoTaskRequest` | interface | Upstream create-task request body |
| `IBytedanceCreateVideoTaskResponse` | interface | Upstream create-task response body |
| `IBytedanceVideoTaskResponse` | interface | Upstream task-poll response body |
| `IBytedanceApiErrorResponse` | interface | Upstream error response body |

## Extension Points

None. Consumers instantiate `BytedanceProvider` with `IBytedanceProviderOptions`. Path templates and cancel method can be customized via options but no abstract classes or plug-in interfaces are exposed.

## Error Taxonomy

All errors are returned via `TProviderMediaResult` (Result pattern, never thrown).

| Code | Condition |
|------|-----------|
| `PROVIDER_INVALID_REQUEST` | Empty prompt, empty model, seed field supplied, empty image data/uri, 4xx client error |
| `PROVIDER_AUTH_ERROR` | HTTP 401 / 403 |
| `PROVIDER_JOB_NOT_FOUND` | HTTP 404 |
| `PROVIDER_JOB_NOT_CANCELLABLE` | HTTP 409 |
| `PROVIDER_RATE_LIMITED` | HTTP 429 |
| `PROVIDER_UPSTREAM_ERROR` | 5xx, invalid JSON, missing task id, unexpected status |
| `PROVIDER_TIMEOUT` | Fetch aborted by timeout |

## Test Strategy

- **Unit tests**: `provider.spec.ts` -- 5 test cases covering `createVideo`, `getVideoJob`, `cancelVideoJob`, HTTP error mapping (404), and status normalization. Uses `vi.stubGlobal('fetch', ...)` to mock network calls.
- **Scenario verification**: `pnpm scenario:verify` runs a dry-run example (`examples/example-create-video.ts`).
- **Coverage gaps**: No integration tests against live API; no tests for image input payloads or timeout paths.
