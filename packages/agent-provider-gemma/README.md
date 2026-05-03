# @robota-sdk/agent-provider-gemma

Gemma model-family provider for Robota using OpenAI-compatible local endpoints such as LM Studio.

This provider is separate from Gemini API support. Gemini API behavior belongs to `agent-provider-gemini`; `agent-provider-google` remains only as a compatibility wrapper.

The provider owns Gemma/LM Studio serving-template projection. It filters Gemma reasoning-channel markers from user-visible text and converts documented native tool-call text emitted by the Gemma/LM Studio template into Robota universal `toolCalls` when the referenced tool was declared in the request.

## Usage

```ts
import { GemmaProvider } from '@robota-sdk/agent-provider-gemma';

const provider = new GemmaProvider({
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
  defaultModel: 'gemma-local-model',
});
```

Use this package instead of the generic OpenAI provider for Gemma-family local models. The Gemma provider owns reasoning marker filtering and native tool-call text projection; the shared OpenAI-compatible transport does not infer model-family syntax.

Gemma/LM Studio OpenAI-compatible endpoints support declared Robota function tools. They do not advertise provider-native hosted web search/fetch; use local `WebSearch`/`WebFetch` tools for explicit local web access.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.
