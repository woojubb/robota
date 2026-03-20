# Robota CLI Design

## Summary

A general-purpose AI coding CLI tool (`robota`) built on `@robota-sdk/agent-core`. Users run it in any project directory to get an AI coding assistant that automatically loads AGENTS.md/CLAUDE.md for project context. Claude Code-compatible hooks, settings, skills, and permission structures.

Package: `@robota-sdk/cli` at `packages/cli/`, binary name: `robota`.

## Motivation

Developers need a CLI coding assistant they can run in any project. By building on the robota SDK, the CLI leverages the existing multi-provider agent infrastructure, tool system, and plugin architecture. Claude Code compatibility means users can reuse their existing hooks, settings, and skills configurations.

## Design Decisions

### Decision 1: Hybrid execution mode

REPL is the default. One-shot mode (`robota "fix the bug"`) added in Phase 2. Internal architecture is identical — both modes use a `Session` abstraction that holds the Robota instance, context, and conversation state. REPL wraps `Session` in a readline loop; one-shot calls `session.run(message)` once and exits. Phase 1 implements `Session` as a standalone class so Phase 2 requires no architectural changes.

### Decision 2: Single provider first

MVP uses `@robota-sdk/agent-provider-anthropic` only. The Robota agent supports multi-provider switching, so additional providers (OpenAI, Google) can be added later without architectural changes.

### Decision 3: Claude Code-compatible structures

Hooks, settings, permissions, skills, and context file discovery follow Claude Code's exact formats. This allows users to migrate from Claude Code without rewriting configuration.

### Decision 4: Trust levels with permission overrides

Three trust levels (safe/moderate/full) provide quick presets. Users can override with explicit `permissions.allow`/`permissions.deny` rules using Claude Code's permission syntax.

## Package Structure

```
packages/cli/
├── package.json              # @robota-sdk/cli, bin: { "robota": "./dist/bin.js" }
├── tsconfig.json             # strict: true
├── vitest.config.ts
├── docs/SPEC.md
├── src/
│   ├── bin.ts                # Entry (#!/usr/bin/env node)
│   ├── cli.ts                # Arg parsing, REPL/one-shot branch
│   ├── repl/
│   │   ├── repl-session.ts           # readline-based REPL loop
│   │   ├── repl-renderer.ts          # Streaming output, markdown, syntax highlight
│   │   └── repl-commands.ts          # Slash commands (/help, /clear, /trust, /exit)
│   ├── context/
│   │   ├── context-loader.ts         # AGENTS.md, CLAUDE.md walk-up discovery
│   │   ├── project-detector.ts       # Detect project type (package.json, tsconfig, etc.)
│   │   └── system-prompt-builder.ts  # Assemble context → system message
│   ├── tools/
│   │   ├── bash-tool.ts              # Shell command execution
│   │   ├── read-tool.ts              # File reading with line numbers
│   │   ├── write-tool.ts             # File creation/overwrite
│   │   ├── edit-tool.ts              # String-replace file editing
│   │   ├── glob-tool.ts              # File pattern search
│   │   ├── grep-tool.ts              # Content search (regex)
│   │   └── agent-tool.ts             # Agent dispatch (Phase 2)
│   ├── permissions/
│   │   ├── trust-level.ts            # safe/moderate/full definitions
│   │   ├── permission-gate.ts        # Pre-tool permission check
│   │   └── permission-prompt.ts      # User approval prompt (y/n)
│   ├── hooks/
│   │   ├── hook-registry.ts          # Hook registration/management
│   │   ├── hook-runner.ts            # Event-triggered hook execution
│   │   └── hook-types.ts             # Hook event type definitions
│   ├── config/
│   │   ├── config-loader.ts          # Settings file discovery and merge
│   │   └── config-types.ts           # Settings schema (Zod)
│   └── index.ts
```

### Dependencies

**Prerequisite**: `@robota-sdk/agent-tools` must be created first (see `2026-03-18-agents-package-decomposition-design.md`). Until then, use `createFunctionTool` directly from `@robota-sdk/agent-core`.

```json
{
  "dependencies": {
    "@robota-sdk/agent-core": "workspace:*",
    "@robota-sdk/agent-provider-anthropic": "workspace:*",
    "@robota-sdk/agent-tools": "workspace:*",
    "zod": "^3.23.0",
    "chalk": "^5.3.0",
    "marked": "^14.0.0",
    "marked-terminal": "^7.0.0",
    "cli-highlight": "^2.1.0"
  }
}
```

## Execution Flow

```
User runs `robota`
    │
    ▼
bin.ts: Parse arguments
    ├── No args → REPL mode
    └── Args present → One-shot mode (Phase 2)
    │
    ▼
config-loader: Load settings
    ├── ~/.robota/settings.json (user)
    ├── ./.robota/settings.json (project)
    ├── ./.robota/settings.local.json (local, gitignored)
    └── Merge by precedence (local > project > user)
    │
    ▼
context-loader: Collect project context
    ├── Walk up from cwd: AGENTS.md, CLAUDE.md at each level
    ├── Project meta: package.json, tsconfig.json, .gitignore
    ├── Skill discovery: .agents/skills/, .robota/skills/, ~/.robota/skills/
    └── Trust level from settings or default (moderate)
    │
    ▼
system-prompt-builder: Assemble system message
    ├── Base role: "You are a coding assistant working in {project}..."
    ├── AGENTS.md content (concatenated, walk-up order)
    ├── Available tools and their descriptions
    ├── Trust level permissions (what the agent can/cannot do)
    └── Project metadata (language, package manager, structure)
    │
    ▼
Create Robota instance
    ├── Provider: AnthropicProvider
    ├── Tools: [BashTool, ReadTool, WriteTool, EditTool, GlobTool, GrepTool]
    ├── System message: assembled context
    └── Plugins: as configured
    │
    ▼
Hook: SessionStart (matcher: "startup")
    │
    ▼
REPL loop
    ├── Wait for user input
    ├── Slash command → handle immediately (/help, /clear, /trust safe)
    ├── Normal message → robota.run(message)
    │       │
    │       ▼
    │   Hook: UserPromptSubmit
    │       │
    │       ▼
    │   LLM processes, may issue tool calls
    │       │
    │       ▼
    │   For each tool call:
    │       ├── Hook: PreToolUse (matcher: tool name)
    │       │     └── exit 2 → block, notify LLM
    │       ├── permission-gate: check trust level + permission rules
    │       │     ├── Allowed → execute
    │       │     ├── Needs approval → prompt user y/n
    │       │     └── Denied → block, notify LLM
    │       ├── Execute tool
    │       ├── Hook: PostToolUse / PostToolUseFailure
    │       └── Return result to LLM
    │       │
    │       ▼
    │   Hook: Stop
    │   Render final response (streaming + markdown)
    │
    └── Next input (repeat)
    │
    ▼
Hook: SessionEnd
```

## Tool Specifications

### BashTool

```typescript
// Input
{ command: string, timeout?: number, workingDirectory?: string }

// Behavior
// - child_process.spawn execution
// - Capture stdout/stderr, return to LLM
// - Default timeout 120s, max 600s
// - workingDirectory defaults to cwd
// - Dangerous command detection: rm -rf, git push --force → warn even in full mode
```

### ReadTool

```typescript
// Input
{ filePath: string, offset?: number, limit?: number }

// Behavior
// - Line-numbered output (cat -n style)
// - Binary file detection → "(binary file)" response
// - Default 2000 lines, offset/limit for large files
// - Respects .gitignore patterns (warn if reading ignored files)
```

### WriteTool

```typescript
// Input
{ filePath: string, content: string }

// Behavior
// - Overwrites existing file (requires prior ReadTool check)
// - Auto-creates parent directories
// - Warns when writing to .gitignore-matched paths
```

### EditTool

```typescript
// Input
{ filePath: string, oldString: string, newString: string, replaceAll?: boolean }

// Behavior
// - Validates oldString is unique in file (error if not)
// - replaceAll: true replaces all occurrences
// - Preserves file encoding
```

### GlobTool

```typescript
// Input
{ pattern: string, path?: string }

// Behavior
// - fast-glob based file search
// - Auto-excludes node_modules, .git
// - Results sorted by modification time
```

### GrepTool

```typescript
// Input
{ pattern: string, path?: string, glob?: string, contextLines?: number }

// Behavior
// - Regex content search
// - File-match mode (paths only) or content mode (matching lines)
// - Auto-excludes node_modules, .git
```

### AgentTool (Phase 2)

```typescript
// Input
{ prompt: string, additionalInstructions?: string, trustLevel?: string }

// Behavior
// - Creates new Robota instance
// - Shares same AGENTS.md context
// - additionalInstructions appended to system message
// - Inherits parent trust level (can only lower, not raise)
// - Returns result to parent agent
// - Hook: AgentDispatchStart / AgentDispatchStop fired
```

## Tool Error Contract

All tools return `TToolResult` — a structured result object, never throw. Errors are terminal (no fallback, no retry).

```typescript
interface TToolResult {
  success: boolean;
  output: string; // Content for LLM consumption
  error?: string; // Human-readable error description (when success=false)
}
```

| Tool      | Error condition        | Result                                                                                                            |
| --------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| BashTool  | Timeout exceeded       | `{ success: false, error: "Command timed out after {n}s" }`                                                       |
| BashTool  | Non-zero exit          | `{ success: true, output: "stdout\n---STDERR---\nstderr", exitCode: n }` (non-zero is not an error — LLM decides) |
| ReadTool  | File not found         | `{ success: false, error: "File not found: {path}" }`                                                             |
| ReadTool  | Binary file            | `{ success: true, output: "(binary file, {size} bytes)" }`                                                        |
| WriteTool | Permission denied (OS) | `{ success: false, error: "Permission denied: {path}" }`                                                          |
| EditTool  | oldString not found    | `{ success: false, error: "String not found in file" }`                                                           |
| EditTool  | oldString not unique   | `{ success: false, error: "String matched {n} times, provide more context" }`                                     |
| GlobTool  | No matches             | `{ success: true, output: "No files matched pattern" }`                                                           |
| GrepTool  | No matches             | `{ success: true, output: "No matches found" }`                                                                   |

## Terminal Output Strategy

The CLI uses a dependency-injected `ITerminalOutput` interface instead of `console.*`:

```typescript
interface ITerminalOutput {
  write(text: string): void; // Raw output (streaming chunks)
  writeLine(text: string): void; // Line output
  writeMarkdown(md: string): void; // Rendered markdown
  writeError(text: string): void; // stderr
  prompt(question: string): Promise<string>; // User input
  spinner(message: string): ISpinner; // Activity indicator
}
```

- `repl-renderer.ts` implements `ITerminalOutput` for the terminal
- Tests inject a mock `ITerminalOutput` that captures output
- No `console.*` calls anywhere in production code

## Settings Validation

Settings files are validated with Zod at load time. Validation failure is terminal:

```
$ robota
Error: Invalid settings in .robota/settings.json
  - defaultTrustLevel: Expected "safe" | "moderate" | "full", received "yolo"
  - hooks.PreToolUse[0].hooks[0].timeout: Expected number, received string
```

No partial loading, no ignoring unknown keys. Invalid settings → exit with error message listing all violations.

## Permission System

### Trust Levels

| Tool      | safe    | moderate | full |
| --------- | ------- | -------- | ---- |
| ReadTool  | auto    | auto     | auto |
| GlobTool  | auto    | auto     | auto |
| GrepTool  | auto    | auto     | auto |
| WriteTool | approve | auto     | auto |
| EditTool  | approve | auto     | auto |
| BashTool  | approve | approve  | auto |
| AgentTool | approve | approve  | auto |

### Permission Rule Syntax (Claude Code compatible)

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Read(/src/**/*.ts)",
      "Bash(pnpm *)",
      "Bash(git commit *)",
      "Edit(/src/**)",
      "Glob",
      "Grep"
    ],
    "deny": ["Bash(git push --force *)", "Bash(rm -rf *)", "Read(~/.ssh/**)"]
  }
}
```

Explicit `permissions` override trust level defaults. Evaluation is a deterministic three-step policy lookup (not a fallback chain):

1. Check `deny` list → if matched, **block** (terminal, no further checks)
2. Check `allow` list → if matched, **auto-approve**
3. Apply trust level policy → the trust level table above is a complete, exhaustive mapping of every tool × level combination. This is the primary policy, not a fallback.

## Settings Structure (Claude Code compatible)

### File locations

| Scope   | Path                            | Shared         | Priority |
| ------- | ------------------------------- | -------------- | -------- |
| User    | `~/.robota/settings.json`       | No             | Low      |
| Project | `./.robota/settings.json`       | Yes (git)      | Medium   |
| Local   | `./.robota/settings.local.json` | No (gitignore) | High     |

### Schema

```json
{
  "defaultTrustLevel": "safe | moderate | full",
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "$ENV:ANTHROPIC_API_KEY"
  },
  "permissions": {
    "allow": ["..."],
    "deny": ["..."]
  },
  "env": {
    "VAR_NAME": "value"
  },
  "hooks": {
    "SessionStart": [...],
    "SessionEnd": [...],
    "UserPromptSubmit": [...],
    "PreToolUse": [...],
    "PostToolUse": [...],
    "PostToolUseFailure": [...],
    "AgentDispatchStart": [...],
    "AgentDispatchStop": [...],
    "Stop": [...]
  }
}
```

## Hook System (Claude Code compatible)

### Event types

| Event                | Matcher                          | Fires when             |
| -------------------- | -------------------------------- | ---------------------- |
| `SessionStart`       | `startup`, `resume`              | Session begins/resumes |
| `SessionEnd`         | —                                | Session ends           |
| `UserPromptSubmit`   | —                                | User submits message   |
| `PreToolUse`         | Tool name (`Bash`, `Edit`, etc.) | Before tool executes   |
| `PostToolUse`        | Tool name                        | After tool succeeds    |
| `PostToolUseFailure` | Tool name                        | After tool fails       |
| `AgentDispatchStart` | Agent type                       | Agent starts (Phase 2) |
| `AgentDispatchStop`  | Agent type                       | Agent ends (Phase 2)   |
| `Stop`               | —                                | LLM response complete  |

### Handler format

```json
{
  "matcher": "Bash|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "path/to/script.sh",
      "timeout": 30
    }
  ]
}
```

### Output protocol

- exit 0 + JSON stdout: `{ "continue": true, "systemMessage": "optional context" }`
- exit 2: blocking error (show stderr, block action)
- other exit: non-blocking warning

### Input (environment variables passed to hook scripts)

```
ROBOTA_SESSION_ID=abc123
ROBOTA_HOOK_EVENT=PreToolUse
ROBOTA_TOOL_NAME=Bash
ROBOTA_TOOL_INPUT={"command":"pnpm test"}
ROBOTA_CWD=/path/to/project
ROBOTA_TRUST_LEVEL=moderate
```

## Context Discovery (Claude Code compatible)

### AGENTS.md / CLAUDE.md walk-up

```
From cwd, walk up directory tree:
/project/packages/frontend/src/
  → /project/packages/frontend/AGENTS.md
  → /project/packages/AGENTS.md
  → /project/AGENTS.md
  → /project/CLAUDE.md

Plus user global:
  → ~/.robota/AGENTS.md

Subdirectory context loaded on-demand:
  → When reading files in /project/api/*, load /project/api/AGENTS.md
```

All discovered AGENTS.md/CLAUDE.md contents are concatenated into the system message, with nearest (most specific) files taking highest priority.

### Skill discovery

```
Search order:
1. ./.agents/skills/*/SKILL.md       (project, existing convention)
2. ./.robota/skills/*/SKILL.md       (project, new path)
3. ~/.robota/skills/*/SKILL.md       (user global)
```

SKILL.md frontmatter (Claude Code compatible):

```yaml
---
name: my-skill
description: When to use this skill
user-invocable: true
allowed-tools: 'Read, Grep, Bash(pnpm *)'
---
```

## Phased Delivery

### Phase 1 (MVP)

- REPL mode with readline + streaming + markdown rendering + syntax highlight
- AGENTS.md/CLAUDE.md walk-up context loading
- Project type detection
- 6 tools: Bash, Read, Write, Edit, Glob, Grep
- Trust levels (safe/moderate/full) + Claude Code permission syntax
- Settings file loading (~/.robota/ + .robota/)
- Skill discovery (read-only, present in system message)
- Slash commands: /help, /clear, /trust, /exit

### Phase 2

- Hook system (Claude Code-compatible events, matchers, command handlers)
- AgentTool (dispatched agent dispatch with shared AGENTS.md + additional instructions)
- One-shot mode (`robota "fix the bug"`)
- Session persistence (resume previous conversation)
- `prompt` and `agent` hook handler types

### Phase 3

- Git tools (diff, commit, PR via gh CLI)
- MCP server connection (proxy MCP tools to LLM)
- Additional providers (OpenAI, Google) selectable in settings
- Plugin support (robota SDK plugins loaded via settings)

## Test Strategy

### Unit tests

| Module                | Test focus                                 | Approach                                              |
| --------------------- | ------------------------------------------ | ----------------------------------------------------- |
| context-loader        | Walk-up file discovery, merge order        | Mock filesystem, verify concatenation order           |
| project-detector      | Package.json/tsconfig detection            | Fixture directories with different project types      |
| system-prompt-builder | Context assembly correctness               | Snapshot tests for generated system messages          |
| permission-gate       | Trust level matrix, allow/deny rules       | Table-driven tests for all tool × level combinations  |
| config-loader         | Settings merge precedence                  | Three-layer fixture configs, verify override behavior |
| Each tool             | Input validation, execution, output format | Mock child_process (Bash), mock fs (Read/Write/Edit)  |
| repl-commands         | Slash command parsing and dispatch         | Unit tests per command                                |
| hook-runner           | Event matching, exit code handling         | Mock scripts with controlled exit codes               |

### Integration tests

- Full REPL session with mocked LLM responses: verify tool call → permission check → execution → response flow
- Hook integration: verify PreToolUse blocking prevents tool execution
- Context loading from real directory structures (fixture projects)

### Verification commands

```bash
pnpm --filter @robota-sdk/cli test          # Unit + integration tests
pnpm --filter @robota-sdk/cli typecheck     # Type safety
pnpm --filter @robota-sdk/cli build         # Builds to dist/
npx robota --version                        # Smoke test
```

## Risks and Mitigations

| Risk                                 | Impact                            | Mitigation                                                                           |
| ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------ |
| LLM token usage from large AGENTS.md | High cost, slow responses         | Truncate context to configurable max tokens; summarize distant ancestor files        |
| Shell injection via BashTool         | Security vulnerability            | Spawn with explicit args (no shell interpretation); deny list for dangerous patterns |
| Streaming rendering glitches         | Poor UX during markdown streaming | Buffer partial markdown blocks; only render complete blocks                          |
| Permission bypass via tool chaining  | Security escalation               | Each tool call independently checked; no inherited permissions between calls         |
| Large file reads consuming context   | Token waste                       | Default 2000-line limit; warn LLM about truncation                                   |
| Hook script hangs                    | Blocked REPL                      | Timeout enforcement (default 30s); kill on timeout                                   |

## Success Criteria

- [ ] `npx @robota-sdk/cli` launches REPL
- [ ] AGENTS.md auto-discovered and loaded into context
- [ ] All 6 tools functional with permission gating
- [ ] Trust level switching via /trust command
- [ ] Settings loaded from ~/.robota/ and .robota/
- [ ] Streaming markdown rendering in terminal
- [ ] All tests pass with `pnpm test`
- [ ] `pnpm typecheck` passes
- [ ] `docs/SPEC.md` complete for the package
