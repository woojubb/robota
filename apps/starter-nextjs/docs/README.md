# Starter Next.js App — Documentation

Minimal Next.js 15 starter template (`@robota-sdk/starter-nextjs`, internal). It has a single App Router API
route, `POST /api/chat` (`app/api/chat/route.ts`), which takes `{ "message": "..." }` and submits it to a
fresh agent session built with `createAgentRuntime` from `@robota-sdk/agent-framework` (its Node host from
`@robota-sdk/agent-framework/node`, the default tools from `@robota-sdk/agent-tools/defaults`) and
`AnthropicProvider` from `@robota-sdk/agent-provider/anthropic` (requires `ANTHROPIC_API_KEY`). The route
answers anyone who can reach it, so its sessions have none of the built-in
command, file, network or file-sending tools; read the safety caveat in the SPEC before exposing it. `pnpm --filter
@robota-sdk/starter-nextjs test` runs the route against a scripted provider.

## Documents

| Document             | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Contract: what the template demonstrates, what it leaves out, the safety caveat |
