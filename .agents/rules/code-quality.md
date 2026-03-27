# Code Quality Rules

Mandatory rules for type safety, imports, and development patterns.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Type System (Strict)

- TypeScript strict mode is immutable and must never be disabled.
- `any` and `{}` are prohibited in production code.
- `unknown` is allowed only at trust boundaries and `catch` boundaries, and must be narrowed before domain use.
- `// @ts-ignore` and `// @ts-nocheck` are prohibited.
- `I*` prefix is for interfaces only. `T*` prefix is for type aliases only. Type aliases with `I*` prefix or interfaces with `T*` prefix are naming violations and must be renamed.
- In test files (`*.test.ts`, `*.spec.ts`), `any` and `unknown` may be used only for mocks or boundary fixtures.
- Follow owner-based SSOT: every concept has exactly one owner module. Import from the owner's public surface and never re-declare owned contracts.
- **No cross-package type duplication.** Defining structurally identical interfaces or types independently in multiple packages is prohibited. One package owns the SSOT; others import or re-export. If importing would create a circular dependency, move the type to a lower-level package (e.g., agent-core).
- To use another package's type: import and use it directly, or re-export it (`export type { X } from`). Do not create a wrapper alias.
- A new type that structurally overlaps with an existing type is allowed only when the package cannot expose the original (e.g., exposing only a subset of fields, decoupling from an internal dependency). The new type must have a distinct name that reflects its narrowed purpose.
- Trivial 1:1 type aliases (`type X = Y`) are prohibited. Union, intersection, mapped, and conditional types are valid uses of type aliases.
- Object shapes must use `interface`. Type aliases are for unions, intersections, tuples, mapped types, and primitives.
- Prefer `undefined` over `null` for absence of value. `null` is allowed only at API boundaries (JSON serialization).

### Import Standards

- Static ES module imports at the top of files are the default.
- Dynamic import is allowed only for optional modules with explicit ownership and error handling.

### Development Patterns

- NEVER use `console.*` directly in production code.
- ALWAYS use dependency injection for logging and side concerns.
- No blind type assertions without proper validation.
- Separate core behavior from side concerns.
- Prefer `readonly` properties and parameters. Mutation should be explicit and localized.
- Never mutate function parameters directly. Clone or create new objects instead.
- No magic numbers or strings. Use named constants with descriptive names. Exceptions: `0`, `1`, `-1` as array/math primitives.
- Production files should not exceed 300 lines. Functions should not exceed 50 lines. Exceptions require justification in code review.
- **Anti-monolith.** A single file that handles multiple independent concerns (e.g., CLI arg parsing + session setup + mode routing) must be split. Each file should have one clear responsibility. When a file grows past 300 lines, treat it as a signal that it is doing too much — split by responsibility, not by arbitrary line count. Mechanically enforced by `pnpm harness:scan`.
- **Parallel collection invariant.** When two or more collections must maintain a 1:1 relationship (e.g., items and their descriptions, tools and their configs), they must be structurally coupled into a single data structure (array of objects, Map, or tuple). Maintaining separate parallel arrays is prohibited — desynchronization is a guaranteed bug.
- **Post-event hook timing.** Post-event hooks and completion callbacks must fire only after the operation's all state mutations (history replacement, token recalculation, persistence) are fully complete. Firing mid-operation causes observers to see inconsistent state and masks failures in subsequent steps.

### Layered Assembly Architecture

The monorepo follows a strict bottom-up assembly model. Each layer builds on the layer below, never bypassing it.

```
agent-core        ← foundation: interfaces, abstractions, DI, events, plugins
  ↑
agent-sessions    ← session lifecycle, wraps core with permissions/hooks
agent-tools       ← tool implementations (FunctionTool, builtins)
agent-providers   ← AI provider implementations
agent-plugins     ← cross-cutting concerns (logging, usage, etc.)
  ↑
agent-sdk         ← assembly layer: composes core + sessions + tools + providers
  ↑
agent-cli         ← UI layer: consumes SDK, adds terminal UI
```

**Rules:**

- **No hardcoding of cross-cutting concerns.** Logging, persistence, analytics, and other side concerns MUST use the existing plugin/event architecture, not direct I/O (e.g., `fs.appendFileSync`, `console.log`). If no suitable plugin exists, create one or extend an existing one.
- **No layer skipping.** CLI must not directly use agent-core internals that should be wired through agent-sessions or agent-sdk. Each layer consumes only its direct dependency's public API.
- **Composition over integration.** Features should be assembled from existing building blocks (plugins, event service, tool registry) rather than baked into a single class. A 500-line Session class with hardcoded file I/O is a design smell.
- **Interface-first extension.** When adding a capability (e.g., session logging), define the interface in agent-core, implement in a plugin or session package, and wire in agent-sdk. Never implement directly in the consuming layer.
- **Side concerns are injectable.** Any behavior that could vary by deployment (logging destination, storage path, analytics) must be injected, not imported directly.
- **Factory context auto-forwarding.** When a factory function receives a config/context object, optional parameters derivable from that object must use it as the default value (`options.x ?? context.x`). Callers must not be required to manually extract and forward values that the factory already has access to. Explicit overrides take precedence.
