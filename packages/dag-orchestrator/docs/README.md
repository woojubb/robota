# DAG Orchestrator

`@robota-sdk/dag-orchestrator` is the orchestration layer for the Prompt API. It applies cost evaluation, retry policies, and authentication checks on top of the core DAG runtime. This package contains the business logic that the orchestrator server exposes over HTTP/WebSocket.

## Usage

```typescript
import { ... } from '@robota-sdk/dag-orchestrator';
```

## Specification

See [SPEC.md](./SPEC.md) for the full contract and API surface.
