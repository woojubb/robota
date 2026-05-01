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
agent-runtime     ← reusable runtime lifecycle/state/ports for background tasks and subagents
  ↑
agent-sessions    ← session lifecycle, wraps core with permissions/hooks
agent-tools       ← tool implementations (FunctionTool, builtins)
agent-providers   ← AI provider implementations
agent-plugins     ← cross-cutting concerns (logging, usage, etc.)
  ↑
agent-sdk         ← assembly layer: composes core + sessions + tools + providers
  ↑
agent-command-*   ← optional command modules that consume SDK command interfaces
  ↑
agent-cli         ← product/UI layer: consumes SDK and selected command modules
```

**Rules:**

- **No hardcoding of cross-cutting concerns.** Logging, persistence, analytics, and other side concerns MUST use the existing plugin/event architecture, not direct I/O (e.g., `fs.appendFileSync`, `console.log`). If no suitable plugin exists, create one or extend an existing one.
- **No invented prompt/protocol directives.** Do not add arbitrary parser syntax, instruction strings, pseudo tool-call markers, model/provider heuristics, or magic command text in code or tests to force behavior. Protocol handling must come from an owned SPEC, a public external standard, or an injected adapter/strategy selected by composition.
- **Provider domain neutrality.** Provider packages may translate provider-specific wire formats into universal messages and tool calls only through declared tool schemas, provider-owned protocol adapters, or injected projection strategies. A provider must not hardcode Robota domain tools, command names, slash commands, agent/subagent concepts, backlog concepts, CLI/TUI behavior, or product workflow semantics. If a model emits XML-like tool artifacts, the provider may parse generic XML and match only the request's declared tool names; it must not infer undeclared tool calls from tag names, role labels, or free-form command-like text.
- **No user-session examples in model-facing guidance.** Do not promote ad hoc examples from user conversations into system prompts, tool descriptions, command descriptors, package specs, or tests. Model-facing examples must be generic, language-neutral, and owned by the relevant SPEC or command/tool contract.
- **No layer skipping.** CLI must not directly use agent-core internals that should be wired through agent-sessions or agent-sdk. Each layer consumes only its direct dependency's public API.
- **Composition over integration.** Features should be assembled from existing building blocks (plugins, event service, tool registry) rather than baked into a single class. A 500-line Session class with hardcoded file I/O is a design smell.
- **Interface-first extension.** When adding a capability (e.g., session logging), define the interface in agent-core, implement in a plugin or session package, and wire in agent-sdk. Never implement directly in the consuming layer.
- **Side concerns are injectable.** Any behavior that could vary by deployment (logging destination, storage path, analytics) must be injected, not imported directly.
- **Factory context auto-forwarding.** When a factory function receives a config/context object, optional parameters derivable from that object must use it as the default value (`options.x ?? context.x`). Callers must not be required to manually extract and forward values that the factory already has access to. Explicit overrides take precedence.
- **Composable material first.** Reusable capabilities must be shaped as small composable packages, ports, adapters, classes, and pure functions before they are wired into SDK or UI flows. The SDK should assemble reusable materials; CLI/TUI should render and inject runtime adapters. Do not let a feature become a CLI-only or SDK-only monolith when it has its own lifecycle, state model, adapters, or non-UI consumers.
- **Package extraction trigger.** Before adding a substantial capability to an existing package, ask whether it is reusable outside that package's primary role. If the answer is yes, prefer a dedicated lower-level package or a clearly isolated module with public ports. A runtime capability with multiple adapters, transport projections, or independent tests is a strong candidate for package extraction.
- **Orchestrator/adapter split.** Lifecycle orchestration, state transitions, and handoff metadata belong in reusable lower layers. Concrete I/O such as `child_process`, local files, Git commands, HTTP servers, and React/Ink rendering belongs in injected adapters or shell packages.
- **Command module isolation.** Optional command packages (`agent-command-*`) consume SDK command interfaces and are selected by composition roots. `agent-sdk` must not import or special-case optional command packages. Product shells such as `agent-cli` may import selected command modules to assemble a default product experience.
