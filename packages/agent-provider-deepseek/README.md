# @robota-sdk/agent-provider-deepseek

DeepSeek provider for Robota using DeepSeek's OpenAI-compatible Chat Completions API.

This provider owns DeepSeek defaults, setup metadata, official setup help links, model catalog metadata, thinking controls, and
error framing while reusing the shared OpenAI-compatible Chat Completions primitives.

```ts
import { DeepSeekProvider } from '@robota-sdk/agent-provider-deepseek';

const provider = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
  defaultModel: 'deepseek-v4-flash',
});
```

DeepSeek thinking mode can be configured through provider-owned options without adding CLI or SDK
provider-name branches:

```ts
const provider = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY,
  defaultModel: 'deepseek-v4-pro',
  thinking: 'enabled',
  reasoningEffort: 'high',
});
```

## Provider Definition

`createDeepSeekProviderDefinition()` exposes setup metadata and official setup help links so CLI and SDK composition can configure
DeepSeek profiles from injected provider definitions. The default base URL is
`https://api.deepseek.com`, and the default API-key reference is `$ENV:DEEPSEEK_API_KEY`.

CLI settings can pass DeepSeek-owned thinking controls through the generic provider profile
`options` bag:

```json
{
  "currentProvider": "deepseek",
  "providers": {
    "deepseek": {
      "type": "deepseek",
      "model": "deepseek-v4-pro",
      "apiKey": "$ENV:DEEPSEEK_API_KEY",
      "options": {
        "thinking": "enabled",
        "reasoningEffort": "high"
      }
    }
  }
}
```

See [docs/SPEC.md](docs/SPEC.md) for the package contract.
