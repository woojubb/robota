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
├── agent-provider/             ← Consolidated AI provider (sub-paths: /anthropic, /openai, /gemini, /google, /gemma, /qwen, /deepseek, /bytedance)
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
├── agent-ui-web/        ← Shared GUI core (SessionMonitor + session reducer)
├── agent-transport-webrtc-web/ ← Browser WebRTC peer over the GUI core
├── agent-mcp/                  ← MCP definitions, control plane, client adapter
└── agent-playground/           ← Playground executor, hooks, and components

apps/
├── agent-web/                  ← Next.js playground host
# (the CLI-served monitor SPA is packages/agent-cli-web — GUI-007)
├── agent-app/                  ← Electron desktop GUI app; drives a robota --serve sidecar over the shared GUI core
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

A package's first publish cannot use trusted publishing. The owner publishes it once locally and then
registers the workflow as its trusted publisher:

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
