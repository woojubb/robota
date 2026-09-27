# @robota-sdk/agent-provider-bytedance

ByteDance (ModelArk) video generation provider for the Robota SDK. `BytedanceProvider` implements
the `IVideoGenerationProvider` contract from `@robota-sdk/agent-core`: it creates a video
generation task, reads its status, and cancels it, over a small built-in HTTP client (`fetch`, no
vendor SDK). It is a media provider, not a chat provider, so it is used directly rather than passed
to a `Robota` agent's `aiProviders`.

## Installation

```bash
npm install @robota-sdk/agent-provider-bytedance @robota-sdk/agent-core
```

## Usage

```typescript
import { BytedanceProvider } from '@robota-sdk/agent-provider-bytedance';

const provider = new BytedanceProvider({
  apiKey: process.env.SEEDANCE_API_KEY ?? '',
  baseUrl: process.env.SEEDANCE_BASE_URL ?? '', // your ModelArk API base URL
});

const created = await provider.createVideo({
  model: 'seedance-2.0',
  prompt: 'A paper boat drifting down a rainy street',
});
if (!created.ok) throw new Error(created.error.message);

const snapshot = await provider.getVideoJob(created.value.jobId);
if (snapshot.ok && snapshot.value.status === 'succeeded') {
  console.log(snapshot.value.output?.uri);
}

// Stop a job that is still running.
await provider.cancelVideoJob(created.value.jobId);
```

The provider has three methods: `createVideo(request)` starts a task, `getVideoJob(jobId)` reads its
current state, and `cancelVideoJob(jobId)` cancels it. `getVideoJob` and `cancelVideoJob` both return
a job snapshot whose status is normalized to `queued`, `running`, `succeeded`, `failed` or
`cancelled`. A `failed` snapshot carries the vendor's error message in `error` when the API sends one.

`durationSeconds` and `aspectRatio` are forwarded as the task's `duration` and `ratio`. A request
may include `inputImages` (inline base64 or URI); they are sent to the task as image content
alongside the prompt. A request with `seed` is rejected as invalid.

## Options

`new BytedanceProvider(options: IBytedanceProviderOptions)`.

| Option                        | Type                     | Description                                                                                      |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `apiKey`                      | `string`                 | Sent as `Authorization: Bearer <apiKey>` (required).                                             |
| `baseUrl`                     | `string`                 | API base URL that task paths are appended to (required).                                         |
| `createVideoPath`             | `string`                 | Task creation path (default `/contents/generations/tasks`).                                      |
| `getVideoTaskPathTemplate`    | `string`                 | Task lookup path; `{taskId}` is replaced (default `/contents/generations/tasks/{taskId}`).       |
| `cancelVideoTaskPathTemplate` | `string`                 | Task cancellation path; `{taskId}` is replaced (default `/contents/generations/tasks/{taskId}`). |
| `cancelVideoTaskMethod`       | `'POST' \| 'DELETE'`     | HTTP method for cancellation (default `'DELETE'`).                                               |
| `timeoutMs`                   | `number`                 | Per-request timeout in milliseconds (default `60000`).                                           |
| `defaultHeaders`              | `Record<string, string>` | Extra headers added to every request.                                                            |

## Errors

Every method returns a result object (`{ ok: true, value }` or `{ ok: false, error }`) instead of
throwing. `error.code` is normalized, and `error.status` holds the HTTP status when the failure was an
HTTP response:

| `code`                         | When                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVIDER_INVALID_REQUEST`     | The request fails a local check (empty prompt, model, job id or input image; `seed` set), or the API answers with another 4xx status. |
| `PROVIDER_AUTH_ERROR`          | HTTP 401 or 403.                                                                                                                      |
| `PROVIDER_JOB_NOT_FOUND`       | HTTP 404.                                                                                                                             |
| `PROVIDER_JOB_NOT_CANCELLABLE` | HTTP 409: the job's current state does not allow cancellation.                                                                        |
| `PROVIDER_RATE_LIMITED`        | HTTP 429.                                                                                                                             |
| `PROVIDER_TIMEOUT`             | No response within `timeoutMs`.                                                                                                       |
| `PROVIDER_UPSTREAM_ERROR`      | HTTP 5xx, a network failure, or a response the provider cannot read (not JSON, no task id, an unknown status).                        |

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the `IVideoGenerationProvider` contract and
  the media result types.
- [`@robota-sdk/agent-builtin-providers`](../agent-builtin-providers/README.md): the default media
  provider definitions, including a Seedance video definition built on this provider.
- [`@robota-sdk/agent-provider-gemini`](../agent-provider-gemini/README.md): image generation through
  Gemini.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
