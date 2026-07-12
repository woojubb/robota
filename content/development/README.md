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
├── agent-transport/            ← Lean transport core (sub-paths: /headless, /testing, /programmatic)
├── agent-transport-tui/        ← TUI transport (Ink/React) — standalone
├── agent-transport-http/       ← HTTP/REST transport — standalone
├── agent-transport-ws/         ← WebSocket transport — standalone
├── agent-transport-mcp/        ← MCP transport — standalone
├── agent-interface-transport/  ← Transport type contracts (zero deps)
├── agent-interface-tui/        ← TUI interaction type contracts (zero deps)
├── agent-cli/                  ← Terminal AI coding assistant
├── agent-subagent-runner/      ← Opt-in child-process subagent runner
├── agent-remote-client/        ← HTTP client for remote agents
├── agent-transport-gui/        ← Shared GUI core (SessionMonitor + session reducer)
├── agent-transport-webrtc-web/ ← Browser WebRTC peer over the GUI core
├── agent-tool-mcp/             ← MCP tool client adapter
└── agent-playground/           ← Playground executor, hooks, and components

apps/
├── agent-web/                  ← Next.js playground host
├── agent-web-monitor/          ← CLI-served browser monitor SPA (Vite)
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

```bash
pnpm harness:verify:release
pnpm publish:beta
```

`pnpm harness:verify:release` uses the root monorepo build instead of rebuilding each package independently. `pnpm publish:beta` runs the npm authentication preflight first, performs one recursive dry-run, prompts for OTP only after the dry-run succeeds, publishes all non-private packages with `pnpm publish -r`, syncs the `beta` dist-tag to the same version, and verifies both `latest` and `beta` dist-tags. If npm authentication fails, run:

```bash
npm login --registry https://registry.npmjs.org/
```

Never publish individual packages with `--filter`. Always use `pnpm publish:beta`; it resolves `workspace:*` dependencies correctly, avoids sequential per-package publishes, and keeps the monorepo package set on one version.

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
