# @robota-sdk/agent-provider-qwen

Qwen provider for Robota using Alibaba Cloud Model Studio / DashScope OpenAI-compatible Chat Completions.

This provider owns Qwen/DashScope defaults and error framing while reusing the shared OpenAI-compatible transport primitives. It does not implement native DashScope or OpenAI Responses API behavior.

```ts
import { QwenProvider } from '@robota-sdk/agent-provider-qwen';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'qwen-plus',
});
```

See [docs/SPEC.md](docs/SPEC.md) for the package contract.
