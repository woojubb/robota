# @robota-sdk/remote-server-core

Reusable Remote API route wiring for Robota.

## What it provides

- `registerRemoteServerRoutes(app, options)` to mount Remote API routes
- OpenAPI document export: `REMOTE_OPENAPI_DOCUMENT`
- Optional docs routes:
  - `/docs/remote.json`
  - `/docs/remote`

## Quick usage

```typescript
import express from 'express';
import { registerRemoteServerRoutes } from '@robota-sdk/remote-server-core';

const app = express();
registerRemoteServerRoutes({
  app,
  providers: {
    openai: openaiProvider
  },
  logger,
  apiDocsEnabled: true
});
```
