# @robota-sdk/agent-provider-qwen

Qwen provider for Robota using Alibaba Cloud Model Studio / DashScope OpenAI-compatible APIs.

This provider owns Qwen/DashScope defaults and error framing while reusing the shared OpenAI-compatible Chat Completions primitives for normal chat. It also owns a narrow Qwen Responses API path for provider-side `web_search` and `web_extractor`.

```ts
import { QwenProvider } from '@robota-sdk/agent-provider-qwen';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'qwen-plus',
});
```

Provider-side web search/fetch can be enabled without adding Qwen branches to CLI or SDK composition:

```ts
const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  defaultModel: 'qwen3.6-plus',
  builtInWebTools: {
    webSearch: true,
    webFetch: true,
    enableThinking: true,
  },
});
```

When `webFetch` is enabled, the provider sends both `web_search` and `web_extractor` to Qwen Responses API and records provider-side tool provenance in assistant-message metadata. These provider-side tools are separate from Robota local tools and do not bypass local tool permissions.

`getCapabilities()` reports whether Qwen provider-native `web_search` and `web_extractor` are supported and enabled. Generic session setup can request `configureNativeWebTools({ webSearch: true })`; Qwen-specific `builtInWebTools` remains the explicit profile configuration surface for hosted web tools.

## Native Replay Payload Capture

When `IChatOptions.onProviderNativeRawPayload` is provided, the provider emits exact Qwen/DashScope request, response, and stream event payloads for both Chat Completions and the Qwen Responses API path. `agent-core` routes these provider-owned callbacks into provider-neutral `provider_native_raw_payload` execution events for replay-grade session logs.

## Provider Definition

`createQwenProviderDefinition()` exposes setup metadata so CLI and SDK composition can configure Qwen profiles without adding Qwen-specific branches. The default CLI build can prompt for the DashScope API key, model, and base URL using this provider definition.

CLI settings can pass Qwen-owned options through the generic provider profile `options` bag:

```json
{
  "currentProvider": "qwen",
  "providers": {
    "qwen": {
      "type": "qwen",
      "model": "qwen3.6-plus",
      "apiKey": "$ENV:DASHSCOPE_API_KEY",
      "options": {
        "builtInWebTools": {
          "webSearch": true,
          "webFetch": true,
          "enableThinking": true
        }
      }
    }
  }
}
```

See [docs/SPEC.md](docs/SPEC.md) for the package contract.
