# @robota-sdk/bytedance

ByteDance/BytePlus media integration package for Robota SDK.

## Scope

- Seedance-style async video generation lifecycle (`create`, `status`, `cancel`)
- Robota media capability contract compliance via `IVideoGenerationProvider`

## Installation

```bash
npm install @robota-sdk/bytedance @robota-sdk/agents
```

## Quick Start

```typescript
import { BytedanceProvider } from '@robota-sdk/bytedance';

const provider = new BytedanceProvider({
  apiKey: process.env.BYTEDANCE_API_KEY!,
  baseUrl: process.env.BYTEDANCE_BASE_URL!
});

const job = await provider.createVideo({
  prompt: 'A cinematic aerial drone shot of a neon city at night.',
  model: 'seedance-2.0'
});
```

## Notes

- This package focuses on media capability contracts and does not modify `IAIProvider`.
- Provider returns reference-oriented outputs (`asset` / `uri`) and never raw binary buffers.
