# Claude Code & Agent SDK Interface Reference

리서치 날짜: 2026-03-19
목적: Robota CLI 설계 시 Claude Code/Agent SDK 인터페이스 호환성 검토

## Sources

- Claude Code Docs: https://docs.anthropic.com/en/docs/claude-code
- Claude Code Hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Claude Code Settings: https://docs.anthropic.com/en/docs/claude-code/settings
- Claude Code Permissions: https://docs.anthropic.com/en/docs/claude-code/permissions
- Claude Code Memory: https://docs.anthropic.com/en/docs/claude-code/memory
- Claude Code Skills: https://docs.anthropic.com/en/docs/claude-code/skills
- Agent SDK Overview: https://docs.anthropic.com/en/docs/agent-sdk/overview
- Agent SDK TypeScript: https://docs.anthropic.com/en/docs/agent-sdk/typescript
- Agent SDK Python: https://docs.anthropic.com/en/docs/agent-sdk/python
- Agent SDK Hooks: https://docs.anthropic.com/en/docs/agent-sdk/hooks
- Agent SDK Permissions: https://docs.anthropic.com/en/docs/agent-sdk/permissions
- Agent SDK Subagents: https://docs.anthropic.com/en/docs/agent-sdk/subagents
- Agent SDK Sessions: https://docs.anthropic.com/en/docs/agent-sdk/sessions

---

## 1. Built-in Tools

### Claude Code CLI Tools

| Tool                                   | Description                                         | Permission Required |
| -------------------------------------- | --------------------------------------------------- | :-----------------: |
| Read                                   | Read file contents (files, images, PDFs, notebooks) |         No          |
| Write                                  | Create or overwrite files                           |         Yes         |
| Edit                                   | Make targeted edits (old_text → new_text)           |         Yes         |
| Bash                                   | Execute shell commands                              |         Yes         |
| Glob                                   | Find files by pattern matching                      |         No          |
| Grep                                   | Search file contents with regex                     |         No          |
| WebFetch                               | Fetch and process URL content                       |         Yes         |
| WebSearch                              | Perform web searches                                |         Yes         |
| Agent                                  | Spawn subagents                                     |         No          |
| Skill                                  | Execute skills from .claude/skills/                 |         Yes         |
| NotebookEdit                           | Edit Jupyter notebook cells                         |         Yes         |
| AskUserQuestion                        | Multiple-choice questions to user                   |         No          |
| TaskCreate/List/Get/Update/Output/Stop | Task management                                     |         No          |
| CronCreate/List/Delete                 | Schedule recurring prompts                          |         No          |
| EnterPlanMode/ExitPlanMode             | Plan mode control                                   |       No/Yes        |
| EnterWorktree/ExitWorktree             | Git worktree isolation                              |         No          |
| TodoWrite                              | Manage task checklist                               |         No          |
| ToolSearch                             | Search and load deferred MCP tools                  |         No          |
| LSP                                    | Code intelligence (IDE integration)                 |         No          |

### Agent SDK Tools

SDK exposes the same tool set programmatically. Tools are controlled via `allowedTools`/`disallowedTools` options:

```typescript
query({
  prompt: '...',
  options: {
    allowedTools: ['Read', 'Edit', 'Bash'], // auto-approved
    disallowedTools: ['Bash(rm *)'], // always denied
  },
});
```

### Tool Parameter Schemas (Key Tools)

**Read**: `{ file_path: string, offset?: number, limit?: number, pages?: string }`
**Write**: `{ file_path: string, content: string }`
**Edit**: `{ file_path: string, old_string: string, new_string: string }`
**Bash**: `{ command: string, timeout?: number }`
**Glob**: `{ pattern: string, path?: string }`
**Grep**: `{ pattern: string, path?: string, glob?: string, contextLines?: number, output_mode?: "content"|"files_with_matches"|"count" }`
**WebFetch**: `{ url: string, prompt: string }`
**WebSearch**: `{ query: string, allowed_domains?: string[], blocked_domains?: string[] }`
**Agent**: `{ prompt: string, subagent_type?: string, model?: string, isolation?: "worktree" }`

---

## 2. Permission System

### Claude Code Permission Modes

| Mode                | Behavior                                                        |
| ------------------- | --------------------------------------------------------------- |
| `default`           | No auto-approvals; prompt user for each tool                    |
| `acceptEdits`       | Auto-approve file operations (Read/Write/Edit); prompt for Bash |
| `plan`              | No tool execution; Claude plans only                            |
| `dontAsk`           | Deny anything not in allowedTools                               |
| `bypassPermissions` | Auto-approve all tools                                          |

### Permission Rule Syntax

```
Bash                    # All bash commands
Bash(npm run build)     # Exact command
Bash(npm run *)         # Wildcard suffix
Read(/src/**/*.ts)      # Path pattern (relative to project)
Read(~/.env)            # Home directory
Read(//absolute/path)   # Absolute filesystem path
Edit(/docs/**)          # Edit in docs/
WebFetch(domain:github.com)  # Domain restriction
mcp__server__tool       # MCP tool
Agent(MyAgent)          # Specific subagent
```

### Agent SDK Permission Model

```typescript
// Permission modes
type PermissionMode = 'default' | 'dontAsk' | 'acceptEdits' | 'bypassPermissions' | 'plan';

// Dynamic permission callback (SDK only)
async function canUseTool(
  toolName: string,
  input: object,
  context: object,
): Promise<PermissionResult> {
  // Return: PermissionResultAllow() | PermissionResultDeny(message) | PermissionResultAsk()
}
```

---

## 3. Hook System

### Hook Events (Complete)

| Event              | Claude Code |  Agent SDK  | Can Block? |
| ------------------ | :---------: | :---------: | :--------: |
| SessionStart       |      O      | O (TS only) |     No     |
| SessionEnd         |      O      | O (TS only) |     No     |
| InstructionsLoaded |      O      |      -      |     No     |
| UserPromptSubmit   |      O      |      O      |    Yes     |
| PreToolUse         |      O      |      O      |    Yes     |
| PermissionRequest  |      O      |      O      |    Yes     |
| PostToolUse        |      O      |      O      |     No     |
| PostToolUseFailure |      O      |      O      |     No     |
| Stop               |      O      |      O      |    Yes     |
| SubagentStart      |      O      |      O      |    Yes     |
| SubagentStop       |      O      |      O      |    Yes     |
| TaskCompleted      |      O      |      -      |    Yes     |
| TeammateIdle       |      O      |      -      |    Yes     |
| ConfigChange       |      O      |      -      |    Yes     |
| Notification       |      O      |      O      |     No     |
| WorktreeCreate     |      O      |      -      |     No     |
| WorktreeRemove     |      O      |      -      |     No     |
| PreCompact         |      O      |      O      |     No     |
| PostCompact        |      O      |      O      |     No     |
| Elicitation        |      O      |      -      |     No     |
| ElicitationResult  |      O      |      -      |     No     |

### CLI Hook Configuration (settings.json)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/validate.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Handler types: `command` (shell), `http` (POST), `prompt` (LLM eval), `agent` (subagent)

### SDK Hook Configuration (programmatic)

```typescript
const myHook = async (input, toolUseID, { signal }) => {
  return {
    systemMessage: 'injected context',
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow' | 'deny' | 'ask',
      permissionDecisionReason: 'reason',
      updatedInput: {
        /* modified tool input */
      },
    },
  };
};

query({
  prompt: '...',
  options: {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [myHook] }],
    },
  },
});
```

Hook output protocol (CLI):

- exit 0 + JSON stdout → `{ "continue": true, "systemMessage": "..." }`
- exit 2 → blocking error (show stderr, block action)
- other exit → non-blocking warning

---

## 4. Settings Structure

### File Locations (CLI)

| Scope          | Path                                                            | Priority |
| -------------- | --------------------------------------------------------------- | -------- |
| Managed        | `/Library/Application Support/ClaudeCode/settings.json` (macOS) | Highest  |
| Local project  | `.claude/settings.local.json`                                   | High     |
| Shared project | `.claude/settings.json`                                         | Medium   |
| User           | `~/.claude/settings.json`                                       | Low      |

### Settings Schema (Key Fields)

```json
{
  "model": "claude-sonnet-4-6",
  "effortLevel": "medium",
  "fastMode": true,
  "defaultMode": "default",
  "permissions": {
    "allow": ["Read", "Bash(npm *)"],
    "ask": ["Edit"],
    "deny": ["Bash(rm -rf *)"]
  },
  "hooks": {
    /* see Hook section */
  },
  "env": { "DEBUG": "false" },
  "sandbox": {
    "enabled": true,
    "filesystem": { "allowRead": ["/tmp/**"], "allowWrite": ["/tmp/**"] },
    "network": { "allowedDomains": ["github.com"] }
  },
  "autoMemoryEnabled": true,
  "claudeMdExcludes": ["**/monorepo/CLAUDE.md"],
  "additionalDirectories": ["/path/to/extra"],
  "enabledPlugins": { "plugin@marketplace": true },
  "theme": "dark",
  "vimMode": false
}
```

### Agent SDK Options

```typescript
interface Options {
  cwd?: string;
  model?: string;
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: 'default' | 'dontAsk' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  hooks?: Record<string, HookMatcher[]>;
  agents?: Record<string, AgentDefinition>;
  mcpServers?: Record<string, MCPServerConfig>;
  settingSources?: ('user' | 'project')[];
  resume?: string;
  continue?: boolean;
  forkSession?: boolean;
  persistSession?: boolean;
  thinking?: { type: 'enabled'; budget_tokens: number };
  sandbox?: { enabled: boolean };
  maxTurns?: number;
  maxBudgetUsd?: number;
}
```

---

## 5. Context Discovery (CLAUDE.md / AGENTS.md)

### Walk-up Discovery

```
From cwd, walk up directory tree:
/project/packages/frontend/src/
  → /project/packages/frontend/CLAUDE.md
  → /project/packages/CLAUDE.md
  → /project/CLAUDE.md
  → ~/.claude/CLAUDE.md (user global)

Path-specific rules: .claude/rules/**/*.md
  (with paths: frontmatter for pattern matching)

Subdirectory context: loaded on-demand when reading files in that dir
```

### Import Syntax

```markdown
@path/to/file.md # Relative to CLAUDE.md
@~/personal-rules.md # Home directory
@README.md # Project file
```

### Auto Memory

- Stored in `~/.claude/projects/<project>/memory/`
- MEMORY.md loaded at session start (first 200 lines)
- Topic files loaded on demand

---

## 6. Session Management

### CLI

```bash
claude                          # New session
claude -c                       # Continue last session
claude -r "session-name"        # Resume by name/ID
claude --fork-session           # Fork instead of continue
```

### SDK

```typescript
// Resume session
query({ prompt: 'continue', options: { resume: 'session-id' } });

// List sessions
const sessions = await listSessions({ cwd: '/project' });

// Get messages
const messages = await getSessionMessages('session-id');
```

### Context Compaction

- `/compact` in CLI
- Auto-compact when context window fills
- Removes early messages, preserves CLAUDE.md and recent context

---

## 7. CLI Flags

```bash
claude                          # Interactive REPL
claude "prompt"                 # Start with prompt
claude -p "prompt"              # Print mode (exit after response)
claude -p --output-format json  # JSON output
claude -p --max-turns 5         # Limit turns
claude -p --max-budget-usd 5    # Cost limit
claude --model sonnet           # Model selection
claude --effort high            # Effort level
claude --permission-mode plan   # Permission mode
claude --allowedTools "Read,Bash(npm *)"
claude --system-prompt "You are..."
claude --append-system-prompt "Extra rule"
claude -c                       # Continue last session
claude -r "name"                # Resume session
claude -w feature-name          # Create worktree
claude --add-dir ../lib         # Add directory
claude --verbose                # Verbose output
claude --version                # Show version
```

---

## 8. Slash Commands (Interactive)

| Command       | Description                    |
| ------------- | ------------------------------ |
| /help         | Show help                      |
| /clear        | New session                    |
| /compact      | Compact context                |
| /config       | Open settings                  |
| /permissions  | Manage permissions             |
| /memory       | View/edit CLAUDE.md and memory |
| /resume       | Pick session to resume         |
| /sessions     | List sessions                  |
| /rename       | Rename session                 |
| /model        | Show/change model              |
| /cost         | Show token usage/cost          |
| /status       | Show status                    |
| /plan         | Enter plan mode                |
| /task, /tasks | Task management                |
| /add-dir      | Add directory                  |
| /agents       | Configure subagents            |
| /hooks        | View hooks                     |
| /mcp          | Configure MCP                  |
| /theme        | Change theme                   |
| /vim          | Toggle vim mode                |
| /init         | Initialize CLAUDE.md           |
| /btw          | Side question (no tools)       |
| /feedback     | Report bug                     |

---

## 9. Agent SDK Streaming Model

```typescript
type SDKMessage =
  | { type: 'system'; subtype: 'init'; session_id: string; tools: Tool[] }
  | { type: 'assistant'; message: { content: ContentBlock[]; stop_reason: string } }
  | {
      type: 'result';
      subtype: 'success' | 'error_max_turns' | 'cancelled';
      result: string;
      total_cost_usd: number;
    };

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: TextBlock[]; is_error?: boolean };
```

---

## 10. Subagent System

### Agent Definition

```typescript
interface AgentDefinition {
  description: string; // When to use this agent
  prompt: string; // System prompt for the agent
  tools?: string[]; // Allowed tools (omit = inherit all)
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}
```

### CLI Agent Files

`.claude/agents/<name>.md` with YAML frontmatter:

```yaml
---
name: code-reviewer
description: Reviews code changes
model: claude-opus-4-1
tools: 'Read,Grep,Bash(git *)'
max_turns: 10
---
Instructions for the agent...
```

---

## 11. Gap Analysis: Robota CLI vs Claude Code/Agent SDK

### Phase 1 필수 추가 항목

| 항목                                        | 이유                                      |
| ------------------------------------------- | ----------------------------------------- |
| Permission modes (plan/acceptEdits/default) | Claude Code 핵심 개념, trust level에 매핑 |
| Session 저장/이어하기                       | UX 필수 기능                              |
| maxTurns 제한                               | 안전장치                                  |
| --version, -p (print mode)                  | CLI 기본                                  |

### Trust Level → Permission Mode 매핑

```
safe     → plan (읽기만, 수정 불가)
moderate → default (수정 시 승인 필요)
full     → acceptEdits (파일 수정 자동, Bash 승인)
--dangerous → bypassPermissions (모두 자동)
```

### Phase 2+ 추가 후보

- WebFetch/WebSearch tools
- Hook system (CLI command + programmatic)
- Agent/Subagent dispatch
- One-shot mode (-p)
- Output format (json/stream-json/text)
- Context compaction
- MCP server integration
- AskUserQuestion tool
- Session list/rename
