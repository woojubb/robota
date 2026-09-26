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
```

Every method returns a result object (`{ ok: true, value }` or `{ ok: false, error }`) instead of
throwing. Errors carry a normalized `code` such as `PROVIDER_AUTH_ERROR`, `PROVIDER_RATE_LIMITED`,
`PROVIDER_TIMEOUT`, `PROVIDER_INVALID_REQUEST`, `PROVIDER_JOB_NOT_FOUND` or
`PROVIDER_UPSTREAM_ERROR`. Job status is normalized to `queued`, `running`, `succeeded`, `failed` or
`cancelled`.

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
