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
pnpm build              # Build all packages
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
├── agent-tools/                ← Tools + 8 built-in CLI tools
├── agent-sessions/             ← Session with permissions/hooks
├── agent-sdk/                  ← Assembly layer
├── agent-cli/                  ← Terminal UI
├── agent-provider-anthropic/   ← Claude provider
├── agent-provider-openai/      ← OpenAI provider
├── agent-provider-google/      ← Google provider
├── agent-plugin-*/             ← 8 extracted plugins
├── agent-team/                 ← Multi-agent task assignment
├── agent-remote/               ← Remote execution
├── agent-tool-mcp/             ← MCP tool protocol
└── dag-*/                      ← DAG workflow (separate domain)
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

6 packages are published to npm. The rest are private.

```bash
pnpm build && pnpm test && pnpm typecheck
pnpm --filter @robota-sdk/<pkg> publish --dry-run --no-git-checks
# Then with OTP:
pnpm --filter @robota-sdk/<pkg> publish --no-git-checks --access public --otp <OTP>
```

Always use `pnpm publish` (not `npm publish`) — pnpm resolves `workspace:*` dependencies.
