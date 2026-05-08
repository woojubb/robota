# Apps and Deployment Architecture

Application deployment topology, service boundaries, and documentation deployment flow.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Agent App Deployment Stack

The agent web app and API service deploy independently. Keep browser-visible UI concerns in the
frontend shell and provider/API-key work in the server-side service.

```mermaid
flowchart TD
  Browser["Browser"]
  AgentWeb["agent-web\nNext.js frontend host"]
  AgentServer["agent-server\nprovider proxy + Playground WebSocket"]
  Providers["AI providers\nOpenAI, Anthropic, Gemini, etc."]
  SessionStorage["Session/runtime storage"]

  Browser --> AgentWeb
  AgentWeb -- "REST + WebSocket" --> AgentServer
  AgentServer --> Providers
  AgentServer --> SessionStorage
```

Deployment ownership:

| Deploy unit    | Runtime shape                       | Required contract                                                                    |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `agent-web`    | Next.js frontend host               | Browser UI imports `agent-playground/client` and keeps provider secrets server-side. |
| `agent-server` | Node service with WebSocket support | Owns provider proxying, Playground WebSocket, CORS, and process lifecycle handling.  |
| `apps/docs`    | Static docs site                    | Builds from repository docs/content and deploys through Cloudflare Pages.            |

Deployment decision:

- Keep `agent-web` deployable on a frontend platform.
- Keep provider credentials, provider API calls, and long-running WebSocket handling out of the
  frontend shell.
- Keep reusable Playground behavior in `agent-playground`; `agent-web` owns only the product route
  and deployment host.
- Remote execution contract ownership stays in `agent-remote-client` and reusable Playground
  execution behavior stays in `agent-playground`; `agent-web` and `agent-server` compose those
  packages without owning their contracts.

## Documentation Deployment Stack

```mermaid
flowchart TD
  Content["content/ + package docs + app docs"]
  Copy["apps/docs/scripts/copy-docs.js"]
  Build["vitepress build"]
  Public["apps/docs/scripts/copy-public.js"]
  Dist["apps/docs/.vitepress/dist"]
  Cloudflare["Cloudflare Pages\nproduction from main"]
  Manual["pnpm docs:deploy\nWrangler direct upload"]

  Content --> Copy
  Copy --> Build
  Build --> Public
  Public --> Dist
  Dist --> Cloudflare
  Dist --> Manual
  Manual --> Cloudflare
```

Docs deployment ownership:

| Concern                        | Owner                                               |
| ------------------------------ | --------------------------------------------------- |
| Documentation source content   | `content/`, package docs, app docs                  |
| Static site build pipeline     | `apps/docs`                                         |
| Production deploy              | Cloudflare Pages Git integration from `main`        |
| Manual direct upload           | `scripts/docs/deploy-cloudflare-pages.mjs`          |
| Release workflow docs behavior | Build verification only; no GitHub Pages deployment |
