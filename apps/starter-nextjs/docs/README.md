# Starter Next.js App — Documentation

Minimal Next.js 15 starter template (`@robota-sdk/starter-nextjs`, internal). It has a single App Router API
route, `POST /api/chat` (`app/api/chat/route.ts`), which takes `{ "message": "..." }` and submits it to a
fresh agent session built with `@robota-sdk/agent-framework` and `@robota-sdk/agent-provider-anthropic`
(requires `ANTHROPIC_API_KEY`). The route answers anyone who can reach it, so its sessions have none of the built-in
command or file tools; read the safety caveat in the SPEC before exposing it. `pnpm --filter
@robota-sdk/starter-nextjs test` runs the route against a scripted provider.

## Documents

| Document             | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Contract: what the template demonstrates, what it leaves out, the safety caveat |
