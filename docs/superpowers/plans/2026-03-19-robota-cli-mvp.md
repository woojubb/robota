# Robota CLI MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `robota` CLI — an AI coding assistant that loads AGENTS.md context and provides tool-calling REPL.

**Architecture:** `Session` class wraps Robota agent instance with context/config. REPL wraps Session in readline loop. 6 tools (Bash, Read, Write, Edit, Glob, Grep) with Claude Code-compatible permission modes (plan/default/acceptEdits/bypassPermissions mapped to trust levels safe/moderate/full). Session persistence for resume. Print mode (-p) for one-shot execution.

**Research:** `docs/superpowers/research/2026-03-19-claude-code-agent-sdk-reference.md`

**Tech Stack:** TypeScript, @robota-sdk/agent-core, @robota-sdk/agent-provider-anthropic, @robota-sdk/agent-tools, zod, chalk, marked, marked-terminal, cli-highlight, fast-glob

**Spec:** `docs/superpowers/specs/2026-03-18-robota-cli-design.md`

---

## File Structure

```
packages/agent-cli/
├── package.json                    # @robota-sdk/agent-cli, bin: { "robota": "./dist/bin.js" }
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.json
├── src/
│   ├── bin.ts                      # #!/usr/bin/env node entry
│   ├── cli.ts                      # Arg parsing, startup orchestration
│   ├── session.ts                  # Session class (Robota instance + context + state)
│   ├── session-store.ts            # Session persistence (save/load/list)
│   ├── types.ts                    # Shared types (TToolResult, ITerminalOutput, etc.)
│   ├── config/
│   │   ├── config-types.ts         # Zod schemas for settings
│   │   └── config-loader.ts        # Settings file discovery + merge + validation
│   ├── context/
│   │   ├── context-loader.ts       # AGENTS.md/CLAUDE.md walk-up discovery
│   │   ├── project-detector.ts     # Detect project type from files
│   │   └── system-prompt-builder.ts # Assemble system message
│   ├── tools/
│   │   ├── bash-tool.ts
│   │   ├── read-tool.ts
│   │   ├── write-tool.ts
│   │   ├── edit-tool.ts
│   │   ├── glob-tool.ts
│   │   └── grep-tool.ts
│   ├── permissions/
│   │   ├── permission-mode.ts      # Permission mode defs (plan/default/acceptEdits/bypass)
│   │   ├── permission-gate.ts      # Permission evaluation logic
│   │   └── permission-prompt.ts    # User y/n prompt
│   ├── repl/
│   │   ├── repl-session.ts         # Readline loop
│   │   ├── repl-renderer.ts        # ITerminalOutput impl (markdown, highlight)
│   │   └── repl-commands.ts        # Slash commands (/help, /clear, /mode, /resume, /cost, /exit)
│   ├── __tests__/
│   │   ├── config-loader.test.ts
│   │   ├── context-loader.test.ts
│   │   ├── project-detector.test.ts
│   │   ├── system-prompt-builder.test.ts
│   │   ├── permission-gate.test.ts
│   │   ├── session-store.test.ts
│   │   ├── bash-tool.test.ts
│   │   ├── read-tool.test.ts
│   │   ├── write-tool.test.ts
│   │   ├── edit-tool.test.ts
│   │   ├── glob-tool.test.ts
│   │   ├── grep-tool.test.ts
│   │   └── repl-commands.test.ts
│   └── index.ts
```

---

## Chunk 1: Package Scaffold + Config + Context

### Task 1: Package scaffolding

**Files:**

- Create: `packages/agent-cli/package.json`
- Create: `packages/agent-cli/tsconfig.json`
- Create: `packages/agent-cli/vitest.config.ts`
- Create: `packages/agent-cli/.eslintrc.json`
- Create: `packages/agent-cli/src/index.ts`
- Create: `packages/agent-cli/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@robota-sdk/agent-cli",
  "version": "3.0.0",
  "description": "AI coding assistant CLI built on Robota SDK",
  "type": "module",
  "bin": { "robota": "./dist/bin.js" },
  "main": "dist/node/index.js",
  "types": "dist/node/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/node/index.d.ts",
      "node": { "import": "./dist/node/index.js", "require": "./dist/node/index.cjs" },
      "default": { "import": "./dist/node/index.js", "require": "./dist/node/index.cjs" }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts src/bin.ts --format esm,cjs --dts --out-dir dist/node --clean",
    "dev": "tsx src/bin.ts",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ --ext .ts,.tsx",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@robota-sdk/agent-core": "workspace:*",
    "@robota-sdk/agent-provider-anthropic": "workspace:*",
    "@robota-sdk/agent-tools": "workspace:*",
    "zod": "^3.24.0",
    "chalk": "^5.3.0",
    "marked": "^14.0.0",
    "marked-terminal": "^7.0.0",
    "cli-highlight": "^2.1.0",
    "fast-glob": "^3.3.0"
  },
  "devDependencies": {
    "rimraf": "^5.0.5",
    "tsup": "^8.0.1",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.6.1"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json, vitest.config.ts, .eslintrc.json**

Standard monorepo configs (same pattern as other packages).

- [ ] **Step 3: Create src/types.ts**

```typescript
export interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

export interface ISpinner {
  stop(): void;
  update(message: string): void;
}

export interface ITerminalOutput {
  write(text: string): void;
  writeLine(text: string): void;
  writeMarkdown(md: string): void;
  writeError(text: string): void;
  prompt(question: string): Promise<string>;
  spinner(message: string): ISpinner;
}

// Permission modes (Claude Code compatible)
// safe=plan, moderate=default, full=acceptEdits
export type TPermissionMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

// Friendly aliases
export type TTrustLevel = 'safe' | 'moderate' | 'full';

export const TRUST_TO_MODE: Record<TTrustLevel, TPermissionMode> = {
  safe: 'plan',
  moderate: 'default',
  full: 'acceptEdits',
};

export type TPermissionDecision = 'auto' | 'approve' | 'deny';
```

- [ ] **Step 4: Create src/index.ts**

```typescript
export { Session } from './session';
export type { TToolResult, ITerminalOutput, TTrustLevel, TPermissionDecision } from './types';
```

- [ ] **Step 5: Run pnpm install and verify build**

```bash
pnpm install
pnpm --filter @robota-sdk/agent-cli build
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(agent-cli): scaffold package with types"
```

### Task 2: Config types and loader

**Files:**

- Create: `packages/agent-cli/src/config/config-types.ts`
- Create: `packages/agent-cli/src/config/config-loader.ts`
- Create: `packages/agent-cli/src/__tests__/config-loader.test.ts`

- [ ] **Step 1: Write config-types.ts with Zod schemas**

Define `SettingsSchema` covering: defaultTrustLevel, provider (name, model, apiKey), permissions (allow, deny), env. Hooks schema is Phase 2 — define as `z.record(z.unknown()).optional()` placeholder.

- [ ] **Step 2: Write failing test for config-loader**

Test cases:

- Loads user settings from ~/.robota/settings.json
- Loads project settings from .robota/settings.json
- Merges with precedence (local > project > user)
- Validates with Zod, throws on invalid
- Returns default config when no files exist

- [ ] **Step 3: Implement config-loader.ts**

`loadConfig(cwd: string)` → reads 3 files, deep-merges, validates with Zod, returns typed config. Use `$ENV:` prefix to resolve env vars.

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @robota-sdk/agent-cli test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-cli): add config loader with Zod validation"
```

### Task 3: Context loader + project detector

**Files:**

- Create: `packages/agent-cli/src/context/context-loader.ts`
- Create: `packages/agent-cli/src/context/project-detector.ts`
- Create: `packages/agent-cli/src/__tests__/context-loader.test.ts`
- Create: `packages/agent-cli/src/__tests__/project-detector.test.ts`

- [ ] **Step 1: Write failing test for project-detector**

Test: given a directory with package.json → detects Node.js project, extracts name, packageManager. Given tsconfig.json → detects TypeScript. Given neither → returns unknown.

- [ ] **Step 2: Implement project-detector.ts**

`detectProject(cwd: string)` → `{ type, name, packageManager, language }`.

- [ ] **Step 3: Write failing test for context-loader**

Test: walk-up from nested dir finds AGENTS.md at each level. Concatenates in order (root first, nearest last). Finds CLAUDE.md. Returns combined content.

- [ ] **Step 4: Implement context-loader.ts**

`loadContext(cwd: string)` → `{ agentsMd: string, claudeMd: string, skills: string[] }`. Walk up directories, collect files, concatenate.

- [ ] **Step 5: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add context loader and project detector"
```

### Task 4: System prompt builder

**Files:**

- Create: `packages/agent-cli/src/context/system-prompt-builder.ts`
- Create: `packages/agent-cli/src/__tests__/system-prompt-builder.test.ts`

- [ ] **Step 1: Write failing test**

Test: given project info + AGENTS.md content + tool list + trust level → builds system message string containing all sections.

- [ ] **Step 2: Implement system-prompt-builder.ts**

`buildSystemPrompt(params)` → assembles base role + AGENTS.md + CLAUDE.md + tool descriptions + trust level + project metadata into a single string.

- [ ] **Step 3: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add system prompt builder"
```

---

## Chunk 2: Tools + Permission System

### Task 5: Permission system (Claude Code compatible modes)

**Files:**

- Create: `packages/agent-cli/src/permissions/permission-mode.ts`
- Create: `packages/agent-cli/src/permissions/permission-gate.ts`
- Create: `packages/agent-cli/src/permissions/permission-prompt.ts`
- Create: `packages/agent-cli/src/__tests__/permission-gate.test.ts`

- [ ] **Step 1: Implement permission-mode.ts**

Define permission modes matching Claude Code:

```typescript
// Permission mode → tool policy matrix
// plan: all tools blocked except Read, Glob, Grep
// default: Read/Glob/Grep auto, Write/Edit/Bash need approval
// acceptEdits: Read/Glob/Grep/Write/Edit auto, Bash needs approval
// bypassPermissions: all auto
```

Export `MODE_POLICY` matrix: `Record<TPermissionMode, Record<string, TPermissionDecision>>`.
Export `TRUST_TO_MODE` mapping for friendly alias support.

- [ ] **Step 2: Write failing tests for permission-gate**

Table-driven tests:

- plan mode: Read auto, Write denied, Bash denied
- default mode: Read auto, Write approve, Bash approve
- acceptEdits mode: Read auto, Write auto, Bash approve
- bypassPermissions: all auto
- deny rule overrides mode
- allow rule overrides mode for specific pattern
- `Bash(pnpm *)` pattern matches `pnpm test` but not `rm -rf`

- [ ] **Step 3: Implement permission-gate.ts**

`evaluatePermission(toolName, toolArgs, mode, permissions)` → `TPermissionDecision`.
Three-step deterministic policy: deny → allow → mode policy.
Pattern matching for `Bash(pnpm *)`, `Read(/src/**)`, etc.

- [ ] **Step 4: Implement permission-prompt.ts**

`promptForApproval(terminal: ITerminalOutput, toolName, toolArgs)` → `Promise<boolean>`.

- [ ] **Step 5: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add permission system with Claude Code-compatible modes"
```

### Task 6: BashTool + ReadTool

**Files:**

- Create: `packages/agent-cli/src/tools/bash-tool.ts`
- Create: `packages/agent-cli/src/tools/read-tool.ts`
- Create: `packages/agent-cli/src/__tests__/bash-tool.test.ts`
- Create: `packages/agent-cli/src/__tests__/read-tool.test.ts`

- [ ] **Step 1: Write failing tests for BashTool**

Test: executes command, returns stdout. Times out after N seconds. Captures stderr. Non-zero exit returns success:true with exitCode.

- [ ] **Step 2: Implement bash-tool.ts**

Create FunctionTool with `createFunctionTool` from `@robota-sdk/agent-tools`. Zod schema: `{ command: z.string(), timeout: z.number().optional(), workingDirectory: z.string().optional() }`. Handler spawns child_process, captures output, enforces timeout.

- [ ] **Step 3: Write failing tests for ReadTool**

Test: reads file with line numbers. Handles offset/limit. Returns error for missing file. Detects binary.

- [ ] **Step 4: Implement read-tool.ts**

- [ ] **Step 5: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add BashTool and ReadTool"
```

### Task 7: WriteTool + EditTool

**Files:**

- Create: `packages/agent-cli/src/tools/write-tool.ts`
- Create: `packages/agent-cli/src/tools/edit-tool.ts`
- Create: `packages/agent-cli/src/__tests__/write-tool.test.ts`
- Create: `packages/agent-cli/src/__tests__/edit-tool.test.ts`

- [ ] **Step 1: Write failing tests for WriteTool**

Test: writes file, creates parent dirs. Returns error on permission denied.

- [ ] **Step 2: Implement write-tool.ts**

- [ ] **Step 3: Write failing tests for EditTool**

Test: replaces unique string. Errors on non-unique. Supports replaceAll.

- [ ] **Step 4: Implement edit-tool.ts**

- [ ] **Step 5: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add WriteTool and EditTool"
```

### Task 8: GlobTool + GrepTool

**Files:**

- Create: `packages/agent-cli/src/tools/glob-tool.ts`
- Create: `packages/agent-cli/src/tools/grep-tool.ts`
- Create: `packages/agent-cli/src/__tests__/glob-tool.test.ts`
- Create: `packages/agent-cli/src/__tests__/grep-tool.test.ts`

- [ ] **Step 1: Write failing tests for GlobTool**

Test: finds files matching pattern. Excludes node_modules/.git. Sorts by mtime.

- [ ] **Step 2: Implement glob-tool.ts**

Uses `fast-glob`. Returns matched paths.

- [ ] **Step 3: Write failing tests for GrepTool**

Test: regex search returns matching lines. file-match mode returns paths only.

- [ ] **Step 4: Implement grep-tool.ts**

Recursive regex search with context lines support.

- [ ] **Step 5: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add GlobTool and GrepTool"
```

---

## Chunk 3: Session + REPL + Entry Point

### Task 9: Session store (persistence)

**Files:**

- Create: `packages/agent-cli/src/session-store.ts`
- Create: `packages/agent-cli/src/__tests__/session-store.test.ts`

- [ ] **Step 1: Write failing tests**

Test: save session (id, messages, metadata) to ~/.robota/sessions/. Load by id. List all sessions sorted by date. Delete session.

- [ ] **Step 2: Implement session-store.ts**

```typescript
interface ISessionRecord {
  id: string;
  name?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: unknown[]; // conversation history
}

class SessionStore {
  save(session: ISessionRecord): void;
  load(id: string): ISessionRecord | undefined;
  list(): ISessionRecord[];
  delete(id: string): void;
}
```

Sessions stored as JSON files at `~/.robota/sessions/{id}.json`.

- [ ] **Step 3: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add session persistence store"
```

### Task 10: Session class

**Files:**

- Create: `packages/agent-cli/src/session.ts`

- [ ] **Step 1: Implement Session class**

```typescript
class Session {
  constructor(config, context, terminal);
  async run(message: string): Promise<string>; // send to Robota, handle tool calls
  getTrustLevel(): TTrustLevel;
  setTrustLevel(level: TTrustLevel): void;
}
```

Session creates Robota instance with AnthropicProvider, registers tools, sets system message. The `run()` method calls `robota.run()` and handles tool call permission checking via permission-gate.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(agent-cli): add Session class"
```

### Task 11: REPL renderer

**Files:**

- Create: `packages/agent-cli/src/repl/repl-renderer.ts`

- [ ] **Step 1: Implement ITerminalOutput for terminal**

Uses chalk for colors, marked + marked-terminal for markdown rendering, cli-highlight for code blocks. Implements write, writeLine, writeMarkdown, writeError, prompt, spinner.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(agent-cli): add REPL renderer with markdown support"
```

### Task 12: Slash commands

**Files:**

- Create: `packages/agent-cli/src/repl/repl-commands.ts`
- Create: `packages/agent-cli/src/__tests__/repl-commands.test.ts`

- [ ] **Step 1: Write failing tests**

Test: /help returns help text. /mode acceptEdits changes permission mode. /clear clears history. /resume lists sessions. /cost shows token usage. /exit returns exit signal. Unknown /command returns error.

- [ ] **Step 2: Implement repl-commands.ts**

`handleSlashCommand(input, session, terminal, sessionStore)` → `{ handled: boolean, exit?: boolean }`.

Commands: /help, /clear, /mode [plan|default|acceptEdits], /resume, /cost, /model, /exit.

- [ ] **Step 3: Verify tests pass, commit**

```bash
git commit -m "feat(agent-cli): add slash commands (/help, /clear, /mode, /resume, /cost, /exit)"
```

### Task 13: REPL session loop

**Files:**

- Create: `packages/agent-cli/src/repl/repl-session.ts`

- [ ] **Step 1: Implement REPL loop**

```typescript
async function startRepl(session: Session, terminal: ITerminalOutput): Promise<void>;
```

Uses `readline.createInterface`. Checks for slash commands first, then sends to session.run(). Displays streaming response. Loops until /exit or Ctrl+C.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(agent-cli): add REPL session loop"
```

### Task 14: CLI entry point + bin

**Files:**

- Create: `packages/agent-cli/src/cli.ts`
- Create: `packages/agent-cli/src/bin.ts`

- [ ] **Step 1: Implement cli.ts**

`startCli()` orchestrates: parse args → loadConfig → loadContext → detectProject → buildSystemPrompt → create Session → startRepl (or print mode). Handles startup errors gracefully.

CLI flags:

```
robota                      # REPL mode (default permission mode)
robota "prompt"             # REPL with initial prompt
robota -p "prompt"          # Print mode (one-shot, exit after response)
robota -c                   # Continue last session
robota -r <id>              # Resume session by ID
robota --model <model>      # Model override
robota --permission-mode <mode>  # plan|default|acceptEdits|bypassPermissions
robota --max-turns <n>      # Limit agentic turns
robota --version            # Show version
```

- [ ] **Step 2: Implement bin.ts**

```typescript
#!/usr/bin/env node
import { startCli } from './cli.js';
startCli().catch((err) => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
```

- [ ] **Step 3: Build and smoke test**

```bash
pnpm --filter @robota-sdk/agent-cli build
npx robota --version
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent-cli): add CLI entry point with --version, -p, -c, -r, --max-turns"
```

---

## Chunk 4: Final Verification

### Task 15: Full build + test + typecheck

- [ ] **Step 1: Run all verifications**

```bash
pnpm --filter @robota-sdk/agent-cli build
pnpm --filter @robota-sdk/agent-cli typecheck
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-cli lint
```

- [ ] **Step 2: Fix any remaining issues**

- [ ] **Step 3: Final commit**

```bash
git commit -m "chore(agent-cli): MVP Phase 1 complete"
```

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
