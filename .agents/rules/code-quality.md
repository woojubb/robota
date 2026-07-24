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
- **Place a shared contract at the lowest layer reachable by every consumer — including dependent or planned consumers, not just current ones.** Before placing a shared type, interface, or injected port, check the dependency graph of all its intended consumers; a port that a lower-layer consumer must call (e.g. a tool that sees only agent-core) cannot live in a higher package, or that consumer can never reach it. Verify reachability for current AND committed-future consumers up front — discovering it after placement forces a second breaking move. (Worked failure: an "ask the user" port placed in a transport package was unreachable by tools that depend only on agent-core — CMD-004 review.)
- To use another package's type: import and use it directly, or re-export it (`export type { X } from`). Do not create a wrapper alias.
- A new type that structurally overlaps with an existing type is allowed only when the package cannot expose the original (e.g., exposing only a subset of fields, decoupling from an internal dependency). The new type must have a distinct name that reflects its narrowed purpose.
- Trivial 1:1 type aliases (`type X = Y`) are prohibited. Union, intersection, mapped, and conditional types are valid uses of type aliases.
- Object shapes must use `interface`. Type aliases are for unions, intersections, tuples, mapped types, and primitives.
- Prefer `undefined` over `null` for absence of value. `null` is allowed only at API boundaries (JSON serialization).

### Import Standards

- Static ES module imports at the top of files are the default.
- Dynamic import is allowed only for optional modules with explicit ownership and error handling.

### Development Patterns

- **No test doubles in production code.** `fake`/`mock`/`stub` name TEST doubles ONLY — never shipped
  dev/production code. A `Fake*`/`Mock*`/`Stub*` class/function/factory (or `create(Fake|Mock|Stub)*`) must not be
  declared or exported from a package's shippable `src` (outside `__tests__/`, `testing/`, `*.test.ts`,
  `*.spec.ts`). A neutral in-memory/reference adapter is fine but must be named for what it IS (`InMemory…`,
  `Manual…`, `Recording…`, `Scripted…`), not "fake/mock". A genuine test-support double that other packages'
  tests reuse belongs under a `testing/` subpath exported via a `./testing` package entry (the
  `@robota-sdk/agent-core/testing` `scripted-provider` precedent), never the package main entry. Mechanically
  enforced by `scan-no-fake-in-src.mjs` (HARNESS-032) — a sanctioned occurrence carries `// allow-fake: <reason>`.
  (Sibling of the No-Fallback floor; both keep test-only constructs out of shipped code.)
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
- **Proper architecture over cheap fixes — design-first, not cost-first.** When proposing a solution or presenting options, lead with the architecturally-correct design — the one that places each responsibility in its proper owner with proper contracts — even when it is a large job (new package, broad migration, multi-consumer rewrite). Do NOT default to, or recommend as the primary option, a minimal/low-churn half-measure (barrel tweak, documented-as-intentional exception, "leave as-is") chosen to avoid scope. Cost, scale, and churn are NOT reasons to prefer a lesser design; the project optimizes for correct foundations, not minimal diffs (unreleased — no backward-compat constraint). If a smaller interim step is genuinely warranted, present it as explicitly secondary to the proper design and state why the proper design is deferred, not as the recommended path. When unsure which placement is "proper," ask — do not silently pick the cheap one. **Neither rework cost nor an existing pattern ("we already do it this way" / precedent) is, on its own, an argument against the correct design** — judge by architectural correctness and consistency; pre-release there is no backward-compat constraint to preserve a lesser structure. See `feedback_proper_foundation_not_minimal`. Proposing the proper design is necessary but not sufficient — **validate it before requesting approval** (reachability, capability preservation, adversarial review for contract-boundary/high-blast-radius changes); see [spec-workflow.md](spec-workflow.md) "Validated Recommendation Before Approval".
- **Legacy is disposable in service of the correct structure; do not take shortcuts.** Pre-release, existing files, rules, packages, or names are not preserved for their own sake — relocating, renaming, deleting, or recreating them is permitted (and expected) when it reaches the correct end-state. A defect discovered along the way (an inconsistency, a latent gap, a convention drift) MUST be absorbed into the correct-structure work — do not bypass it as "out of scope / not now". File/location/ownership moves still follow the present-recommendation-with-reasons gate (do not move silently). See `feedback_legacy_disposable_no_shortcuts`.

### Layered Assembly Architecture

Moved to [`.agents/project-structure.md`](../project-structure.md) § "Layered Assembly
Architecture" (the SSOT for dependency-direction data) — the bottom-up package stack
(agent-core → agent-cli) and the command-layering rules live there. This file owns only the
neutral type/pattern rules above.
