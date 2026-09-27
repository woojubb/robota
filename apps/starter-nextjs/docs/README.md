# Starter Next.js App — Documentation

Minimal Next.js 15 starter template (`@robota-sdk/starter-nextjs`, internal). It has a single App Router API
route, `POST /api/chat` (`app/api/chat/route.ts`), which takes `{ "message": "..." }` and submits it to a
fresh agent session built with `@robota-sdk/agent-framework` and `@robota-sdk/agent-provider-anthropic`
(requires `ANTHROPIC_API_KEY`). The route is an unauthenticated local demo; read the safety caveat in the
SPEC before exposing it.

## Documents

| Document             | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Contract: what the template demonstrates, what it leaves out, the safety caveat |
