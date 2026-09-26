# Development

Guide for contributing to the Robota SDK monorepo.

## Setup

```bash
git clone https://github.com/woojubb/robota.git
cd robota
pnpm install
pnpm build
pnpm test
```

### Requirements

- **Node.js**: 22.14.0 (managed by Volta)
- **pnpm**: 8.15.4
- **Module system**: ES modules only (`"type": "module"`)

## Commands

```bash
pnpm build              # Build the package workspace once from the repo root
pnpm test               # Run all tests
pnpm typecheck          # TypeScript strict check
pnpm lint               # ESLint
pnpm harness:scan       # Full harness verification
```

### Per-Package

```bash
pnpm --filter @robota-sdk/<pkg> build
pnpm --filter @robota-sdk/<pkg> test
```

## Run From Source

Each surface runs this checkout's code, not a `robota` installed on PATH:

```bash
pnpm cli:dev                # the terminal UI, from source — no build needed
pnpm gui:dev                # the GUI in a browser: page and CLI from source, hot reload, no build needed
pnpm gui:dev --scripted     # the same page with a deterministic sidecar: no model, no API key
pnpm app:dev                # the desktop app: builds the page and what it bundles, then opens the window
```

The CLI always runs through `scripts/dev/robota`, which starts `packages/agent-cli/src/bin.ts` with the
`source` export condition. `cli:dev` works in the repo root; the GUI and the desktop app serve the directory
the command was started from (or `ROBOTA_DEV_CWD`). That directory must be a trusted workspace
(`pnpm cli:dev trust --yes` for the repo root). All of them use your own `~/.robota`.

The desktop app reattaches to the workspace's running daemon when there is one. After changing CLI code, stop
it in the directory the app serves, so the next `app:dev` starts a daemon on the new code:

```bash
<repo>/scripts/dev/robota daemon stop
```

## Monorepo Structure

```
packages/
├── agent-core/                 ← Foundation (zero deps)
├── agent-tools/                ← Tools + 9 built-in CLI tools
├── agent-session/              ← Session with permissions/hooks
├── agent-session-analytics/    ← Session log timing analysis (new in beta.76)
├── agent-executor/             ← Background task and subagent lifecycle
├── agent-framework/            ← Assembly layer (InteractiveSession, createQuery)
├── agent-command/              ← All slash command modules in one package
├── agent-provider-anthropic/   ← Anthropic provider client
├── agent-provider-openai/      ← OpenAI provider client
├── agent-provider-openai-compatible/ ← OpenAI-compatible clients (DeepSeek, Qwen, Gemma)
├── agent-provider-gemini/      ← Gemini / Google provider client
├── agent-provider-bytedance/   ← ByteDance video generation provider client
├── agent-builtin-providers/    ← Built-in provider definitions + default role-to-model mapping
├── agent-plugin/               ← Consolidated plugin package
├── agent-transport/            ← Browser-safe protocol/delivery substrate (sub-paths: /client, /node)
├── agent-ui-terminal/        ← Terminal UI (Ink/React) — standalone
├── agent-transport-http/       ← HTTP/REST transport — standalone
├── agent-transport-ws/         ← WebSocket transport — standalone
├── agent-transport-mcp/        ← MCP transport — standalone
├── agent-interface-transport/  ← Transport type contracts (zero deps)
├── agent-interface-tui/        ← TUI interaction type contracts (zero deps)
├── agent-cli/                  ← Terminal AI coding assistant
├── agent-subagent-runner/      ← Opt-in child-process subagent runner
├── agent-remote-client/        ← HTTP client for remote agents
├── agent-ui-web/               ← Shared GUI core (components + session reducer)
├── agent-gui-web/              ← The GUI web app: loaded by the desktop app, served by `robota --serve --open`
├── agent-transport-webrtc-web/ ← Browser WebRTC peer over the GUI core
├── agent-mcp/                  ← MCP definitions, control plane, client adapter
└── agent-playground/           ← Playground executor, hooks, and components

apps/
├── agent-web/                  ← Next.js playground host
├── agent-app/                  ← Electron shell: runs the robota --serve sidecar and loads agent-gui-web
├── agent-server/               ← AI provider proxy + WebSocket server
├── docs/                       ← VitePress documentation site
└── blog/                       ← Blog
```

## Key Rules

- **TypeScript strict mode** — `any` and `{}` prohibited in production code
- **SPEC.md required** — Every package must have `docs/SPEC.md`
- **TDD** — Red-green-refactor cycle
- **Spec-first** — Update SPEC before code changes
- **No fallbacks** — Single correct path, no silent alternatives
- **One-way dependencies** — No circular deps between packages
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`

See [AGENTS.md](https://github.com/woojubb/robota/blob/main/AGENTS.md) for the complete rule set.

## Publishing

Robota publishes every non-private package together with one coordinated version. The current beta
package set publishes approved `@robota-sdk/*` packages; private app, plugin, and internal packages
are not published by the beta script.

Releases publish from GitHub Actions: run the **Publish to npm** workflow (`.github/workflows/publish.yml`) on
`main` and approve the `npm-publish` environment. It uses npm trusted publishing (OIDC), so no npm token is
stored anywhere and every package carries a provenance attestation. Packages are published under `latest`
only.

A package's first publish cannot use trusted publishing, so the workflow refuses a release that contains a
package npm has never seen. The owner publishes that release locally instead (every package of the release,
without provenance) and then registers the workflow as the new package's trusted publisher, so later releases
use the workflow again:

```bash
pnpm publish:beta --dry-run
pnpm publish:beta
bash scripts/publish/configure-trusted-publishers.sh @robota-sdk/<new-package>
```

`pnpm publish:beta` builds, runs the release checks, packs and verifies every tarball, and then publishes
each public package whose version is not on npm yet (it prompts for the npm OTP). If npm authentication
fails, run `npm login --registry https://registry.npmjs.org/`.

Never publish individual packages with `--filter`. The scripts resolve `workspace:*` dependencies correctly
and keep the monorepo package set on one version.

## Documentation Sync

When package behavior changes, update the package README, the package docs page, and the relevant robota.io source page in the same PR:

- `packages/<pkg>/README.md` — npm/GitHub package README
- `packages/<pkg>/docs/README.md` — copied to robota.io as `/packages/<pkg>/`
- `packages/<pkg>/docs/SPEC.md` — package contract truth
- `content/README.md` — robota.io home page
- `content/guide/*.md` and `content/examples/*.md` — user-facing guides and examples

After changing `content/` or `packages/*/docs/`, run:

```bash
pnpm docs:build
```
