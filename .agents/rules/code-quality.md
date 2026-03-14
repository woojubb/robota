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
