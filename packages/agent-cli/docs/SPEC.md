# SPEC.md — @robota-sdk/agent-cli

## Scope

AI coding assistant CLI that runs in any project directory. Loads AGENTS.md/CLAUDE.md for context, provides a REPL with 6 built-in tools (Bash, Read, Write, Edit, Glob, Grep), and supports Claude Code-compatible permission modes and settings.

## Boundaries

- Does NOT own AI provider logic — delegates to `@robota-sdk/agent-provider-anthropic`
- Does NOT own agent runtime or tool execution loop — delegates to `@robota-sdk/agent-core`
- Does NOT own tool implementations (FunctionTool, schema conversion) — uses `@robota-sdk/agent-tools`
- Hook system (Phase 2), MCP integration (Phase 3), and sub-agent dispatch (Phase 2) are not yet implemented

## Architecture Overview

```
bin.ts → cli.ts (arg parsing, orchestration)
              ├── config/config-loader.ts    (settings discovery + Zod validation)
              ├── context/context-loader.ts   (AGENTS.md/CLAUDE.md walk-up)
              ├── context/project-detector.ts (package.json/tsconfig detection)
              ├── context/system-prompt-builder.ts (context → system message)
              ├── session.ts                  (Robota wrapper + permission gate)
              ├── session-store.ts            (JSON file persistence)
              ├── permissions/permission-gate.ts (mode-based policy evaluation)
              ├── tools/                      (6 FunctionTool implementations)
              └── repl/                       (readline loop + renderer + slash commands)
```

Pattern: CLI orchestrator → Session facade → Robota agent core. Permission checks run before each tool execution via the permission gate.

## Type Ownership

| Type                | Location                          | Purpose                                 |
| ------------------- | --------------------------------- | --------------------------------------- |
| TToolResult         | `src/types.ts`                    | Structured tool return value            |
| ITerminalOutput     | `src/types.ts`                    | DI interface for terminal I/O           |
| TPermissionMode     | `src/types.ts`                    | Claude Code-compatible permission modes |
| TTrustLevel         | `src/types.ts`                    | Friendly aliases for permission modes   |
| TPermissionDecision | `src/types.ts`                    | auto/approve/deny decision              |
| ISessionRecord      | `src/session-store.ts`            | Persisted session structure             |
| ISessionOptions     | `src/session.ts`                  | Session constructor options             |
| IResolvedConfig     | `src/config/config-types.ts`      | Validated settings                      |
| ILoadedContext      | `src/context/context-loader.ts`   | Discovered AGENTS.md/CLAUDE.md content  |
| IProjectInfo        | `src/context/project-detector.ts` | Detected project metadata               |

## Public API Surface

| Export              | Kind      | Description                                               |
| ------------------- | --------- | --------------------------------------------------------- |
| Session             | class     | Wraps Robota agent with context, permissions, persistence |
| SessionStore        | class     | JSON file-based session persistence                       |
| startCli            | function  | CLI entry point orchestrator                              |
| TRUST_TO_MODE       | const     | Maps TTrustLevel → TPermissionMode                        |
| TToolResult         | type      | Tool execution result                                     |
| ITerminalOutput     | interface | Terminal I/O contract                                     |
| TPermissionMode     | type      | Permission mode union                                     |
| TTrustLevel         | type      | Trust level union                                         |
| TPermissionDecision | type      | Permission decision union                                 |
| ISessionOptions     | type      | Session constructor options                               |
| ISessionRecord      | type      | Persisted session shape                                   |

## Extension Points

- **AI Provider**: Session accepts an optional `provider` parameter for injecting any `IAIProvider` implementation
- **Terminal I/O**: `ITerminalOutput` interface allows replacing the terminal renderer (e.g., for testing or alternative UIs)
- **Session Store**: `SessionStore` accepts a `baseDir` parameter for custom storage locations
- **Permission modes**: `TPermissionMode` can be extended with new modes in future phases

## Error Taxonomy

| Error                     | Context          | Recoverable                                  |
| ------------------------- | ---------------- | -------------------------------------------- |
| Missing ANTHROPIC_API_KEY | Session creation | No — exit with message                       |
| Invalid settings.json     | Config loading   | No — exit with Zod error details             |
| Tool execution failure    | Tool handler     | Yes — returns TToolResult with success:false |
| Permission denied         | Permission gate  | Yes — tool blocked, LLM notified             |
| Session not found         | --resume flag    | No — exit with message                       |

## Test Strategy

- 13 test files, 145 tests
- Config loader: mock filesystem, Zod validation, merge precedence
- Context loader: mock walk-up discovery, concatenation order
- Project detector: fixture directories
- System prompt builder: snapshot tests
- Permission gate: table-driven tests (40 cases) for all mode×tool combinations
- Tools: mock child_process (Bash), temp directories (Read/Write/Edit/Glob/Grep)
- Slash commands: mock session and terminal
- Session store: temp directory persistence

## Class Contract Registry

| Class        | Implements/Extends | Defined In                  |
| ------------ | ------------------ | --------------------------- |
| Session      | —                  | `src/session.ts`            |
| SessionStore | —                  | `src/session-store.ts`      |
| ReplRenderer | ITerminalOutput    | `src/repl/repl-renderer.ts` |
