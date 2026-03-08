# DAG Media Provider Contract

This document defines how DAG media nodes consume provider capabilities exposed by `@robota-sdk/agents`.

## Capability Contracts

- Image nodes depend on `IImageGenerationProvider`.
- Video nodes depend on `IVideoGenerationProvider`.
- Runtime checks must use:
  - `isImageGenerationProvider(provider)`
  - `isVideoGenerationProvider(provider)`

Do not branch behavior by provider name strings.

## Image Node Mapping

- Generate node -> `generateImage(request)`
- Edit node -> `editImage(request)`
- Compose node -> `composeImage(request)`

Expected provider output:

- `IImageGenerationResult.outputs` with `IMediaOutputRef[]`
- No raw binary payload in provider result

## Video Node Mapping

- Create run -> `createVideo(request)`
- Poll status -> `getVideoJob(jobId)`
- Cancel run -> `cancelVideoJob(jobId)`

Expected status union:

- `queued | running | succeeded | failed | cancelled`

Only `succeeded`, `failed`, and `cancelled` are terminal.

## Error Contract

DAG runtime and API server should map provider errors by `IProviderMediaError.code`:

- `PROVIDER_AUTH_ERROR`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_TIMEOUT`
- `PROVIDER_INVALID_REQUEST`
- `PROVIDER_UPSTREAM_ERROR`
- `PROVIDER_JOB_NOT_FOUND`
- `PROVIDER_JOB_NOT_CANCELLABLE`

No fallback provider path is allowed when a capability is unsupported.
