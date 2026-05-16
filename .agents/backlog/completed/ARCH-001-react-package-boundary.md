# ARCH-001 — Define React Package Boundaries and Extract TUI from agent-transport

## Status

`backlog`

## Problem

`agent-transport` is defined as a generic transport layer (sibling to what used to be `agent-transport-http`, `agent-transport-ws`, `agent-transport-headless` before ARCH-BL-002 consolidation). However, it currently contains **46 `.tsx` files** using React and Ink — a TUI rendering library. This violates the transport abstraction: an HTTP transport layer must never carry a React dependency, and a WebSocket transport must not ship Ink.

The consolidation in ARCH-BL-002 merged everything into `agent-transport`, but TUI code did not belong in the consolidated package. This is architectural debt that must be resolved before React spread further.

## React Usage Survey (as of 2026-05-17)

| Package                     | React type        | Files   | Status                                                              |
| --------------------------- | ----------------- | ------- | ------------------------------------------------------------------- |
| `agent-transport`           | React + Ink (TUI) | 46 tsx  | **Wrong** — TUI code does not belong in a generic transport package |
| `agent-playground`          | React (browser)   | 187 tsx | Correct                                                             |
| `agent-web-ui`              | React (browser)   | 3 tsx   | Correct                                                             |
| `agent-core`                | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-framework`           | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-cli`                 | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-command`             | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-executor`            | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-interface-transport` | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-plugin`              | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-provider`            | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-remote-client`       | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-session`             | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-team`                | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-tool-mcp`            | None (pure TS)    | 0 tsx   | Correct                                                             |
| `agent-tools`               | None (pure TS)    | 0 tsx   | Correct                                                             |

## React Policy (target state)

| Category          | Rule                                                                | Packages allowed                   |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------- |
| React + Ink (TUI) | Only in a dedicated TUI package. Never in generic transport layers. | `agent-transport-tui` (new)        |
| React (browser)   | Only in browser-facing app packages.                                | `agent-playground`, `agent-web-ui` |
| Pure TypeScript   | All SDK, framework, core, transport protocol, and CLI packages.     | Everything else                    |

**Key rule**: A package that can serve multiple transport modalities (HTTP, WebSocket, headless) must have zero React dependencies. TUI rendering is one concrete modality and must be isolated.

## Proposed Solution

Extract the TUI code (all `.tsx` files + Ink dependencies) from `agent-transport` into a new dedicated package: **`agent-transport-tui`**.

### New package: `@robota-sdk/agent-transport-tui`

- Scope: TUI rendering layer using React + Ink
- Dependencies: `react`, `ink`, `@robota-sdk/agent-transport`, `@robota-sdk/agent-framework`
- Position in dependency graph: `agent-transport` → `agent-transport-tui` → `agent-cli`
- `agent-transport` keeps only pure TypeScript transport interfaces and protocol-level code (headless, base classes, etc.)
- `agent-cli` imports from `agent-transport-tui` instead of `agent-transport` for TUI components

### Migration steps

1. Audit `agent-transport/src/tui/` — identify all files that are TUI-only (`.tsx`, Ink imports)
2. Audit `agent-transport/src/` — identify files that are pure TS and must stay in `agent-transport`
3. Create `packages/agent-transport-tui/` workspace with:
   - `package.json` — React + Ink deps, peer dep on `agent-transport`
   - `tsconfig.json` — JSX preserve + react-jsx
   - `src/index.ts` — exports all TUI components
   - `docs/SPEC.md` — package contract
4. Move all TUI files from `agent-transport` to `agent-transport-tui`
5. Update `agent-cli/package.json` — replace `agent-transport` TUI imports with `agent-transport-tui`
6. Remove React + Ink deps from `agent-transport/package.json`
7. Update `agent-transport/tsconfig.json` — remove JSX config
8. Update `agent-transport/docs/SPEC.md` — remove TUI section, clarify it is now pure TS
9. Write `agent-transport-tui/docs/SPEC.md`
10. Build all affected packages, typecheck, run tests

## Affected Files (approximate)

- All `.tsx` files under `packages/agent-transport/src/tui/` → move to `agent-transport-tui`
- `packages/agent-transport/package.json` → remove `react`, `ink`, `@types/react`
- `packages/agent-transport/tsconfig.json` → remove `jsx` compiler option
- `packages/agent-cli/package.json` → add `agent-transport-tui` dep
- `packages/agent-cli/src/**` — update imports that reference `agent-transport` TUI components

## Dependency on Other Backlog Items

- `I18N-001` (TUI i18n) must be implemented **after** this extraction is complete, targeting `agent-transport-tui` not `agent-transport`

## Test Plan

- [ ] `pnpm typecheck` passes across all packages
- [ ] `pnpm build` succeeds for `agent-transport`, `agent-transport-tui`, `agent-cli`
- [ ] `pnpm test` passes for all affected packages
- [ ] `agent-transport` has zero React/Ink dependencies after extraction
- [ ] `agent-transport-tui` renders TUI correctly (manual verification via `agent-cli`)
- [ ] No circular dependencies introduced

## User Execution Test Scenarios

1. Run `agent-cli` and verify TUI renders correctly (menu, picker, confirm dialogs)
2. Confirm `agent-transport` package has no React or Ink in its `node_modules` peer tree
3. Confirm `agent-transport-tui` can be imported standalone and renders a component without `agent-cli`
