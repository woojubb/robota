# Contributing to Robota SDK

Thank you for your interest in contributing. This guide covers the development workflow, code standards, and PR process.

## Development Setup

```bash
git clone https://github.com/woojubb/robota.git
cd robota
pnpm install
pnpm build
pnpm test
```

Requirements: Node.js 22.14.0 (managed by Volta), pnpm 8.15.4.

## Common Commands

```bash
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm typecheck          # TypeScript strict check
pnpm lint               # ESLint
pnpm harness:scan       # Full harness verification

# Per-package
pnpm --filter @robota-sdk/<pkg> build
pnpm --filter @robota-sdk/<pkg> test
```

## Code Standards

- **No `any`** — strict TypeScript in all production code
- **No fallbacks** — one correct path, no silent alternatives
- **Interfaces for shapes** — use `interface` over `type` for object shapes
- **Zod for tool schemas** — use `createZodFunctionTool` with explicit schema
- **Tests first** — red-green-refactor cycle for new features

## PR Checklist

Before submitting:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] New behavior has tests
- [ ] Relevant `docs/SPEC.md` updated if package contract changed
- [ ] Conventional commit message: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`

## Commit Format

```
feat(agent-core): add plugin lifecycle afterRun hook
fix(agent-cli): correct provider flag validation
docs(getting-started): add LM Studio local model path
```

## Where to Start

Look for issues labeled **`good first issue`** on [GitHub Issues](https://github.com/woojubb/robota/issues).

For larger changes, open an issue first to discuss the approach before writing code.

## Package Architecture

One-way dependency rule: `agent-core` has zero workspace dependencies. Each layer only imports from layers below it. See [Architecture docs](https://robota.io/guide/architecture) for the full dependency map.

Never add a circular dependency between packages. The CI harness enforces this.

## Questions

Open a [GitHub Discussion](https://github.com/woojubb/robota/discussions) for questions, ideas, or feedback.
