# Capability: OpenAI-compatible gateway via `baseURL`

Route the OpenAI provider through **any** OpenAI-compatible endpoint — AI gateways
(Vercel AI Gateway, LiteLLM, OpenRouter), Azure, vLLM, Ollama, LM Studio. Model slugs pass
through verbatim (`anthropic/claude-sonnet-4-5` works); streaming and tool calling ride the
same chat-completions protocol.

```bash
pnpm install

GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1 \
GATEWAY_API_KEY=your-gateway-key \
GATEWAY_MODEL=anthropic/claude-sonnet-4-5 \
pnpm dev
```

Local variant (Ollama): `GATEWAY_BASE_URL=http://localhost:11434/v1 GATEWAY_API_KEY=any GATEWAY_MODEL=llama3.2 pnpm dev`

See the [Providers guide — Through an AI gateway](../../../content/guide/providers.md#through-an-ai-gateway).
