# Permissions and Hooks

## Permission System

Defined in `agent-core`, consumed by `agent-sessions`. Provides deterministic 3-step policy evaluation for tool calls.

### Evaluation Algorithm

1. **Deny list** — If any deny pattern matches, return `deny`
2. **Allow list** — If any allow pattern matches, return `auto` (no prompt)
3. **Mode policy** — Look up the tool in the mode matrix

### Permission Modes

| Mode                | Read | Write            | Bash             |
| ------------------- | ---- | ---------------- | ---------------- |
| `plan`              | auto | deny             | deny             |
| `default`           | auto | approve (prompt) | approve (prompt) |
| `acceptEdits`       | auto | auto             | approve (prompt) |
| `bypassPermissions` | auto | auto             | auto             |

### Pattern Syntax

```
Bash(pnpm *)        # Bash with command starting "pnpm "
Read(/src/**)        # Read for files under /src/
Write(*)             # Write with any argument
ToolName             # Match any invocation (no arg constraint)
```

### Configuration

```json
{
  "permissions": {
    "allow": ["Read(*)", "Glob(*)", "Grep(*)", "Bash(pnpm *)"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

## Hook System

Lifecycle hooks for extending session behavior. Defined in `agent-core` and `agent-sdk`, consumed by `agent-sessions`.

### Events

| Event              | Timing                    | Purpose                         |
| ------------------ | ------------------------- | ------------------------------- |
| `PreToolUse`       | Before tool execution     | Validation, blocking            |
| `PostToolUse`      | After tool execution      | Logging, auditing               |
| `PreCompact`       | Before context compaction | Validation                      |
| `PostCompact`      | After context compaction  | Notification (includes summary) |
| `SessionStart`     | Session initialization    | Setup                           |
| `Stop`             | Session termination       | Cleanup                         |
| `UserPromptSubmit` | Before user prompt sent   | Prompt preprocessing, injection |
| `Notification`     | On notification events    | External alerting, logging      |

### Exit Code Protocol

| Code  | Meaning                        |
| ----- | ------------------------------ |
| 0     | Allow / proceed                |
| 2     | Block / deny (stderr = reason) |
| other | Proceed with warning           |

### Hook Types

| Type      | Layer      | Description                                                   |
| --------- | ---------- | ------------------------------------------------------------- |
| `command` | agent-core | Shell command; receives JSON via stdin, uses exit codes       |
| `http`    | agent-core | HTTP POST to a URL; supports env var interpolation in headers |
| `prompt`  | agent-sdk  | Single-turn LLM evaluation; returns model response            |
| `agent`   | agent-sdk  | Multi-turn subagent; runs a full agent loop                   |

### Hook Input

Hooks receive JSON via stdin:

```json
{
  "session_id": "session_1234",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "pnpm test" },
  "prompt": "the user's current prompt text"
}
```

The `prompt` field is included for Claude Code compatibility and contains the user's current prompt text (present for `UserPromptSubmit` and `SessionStart` events).

### Hook Stdout Injection

For `SessionStart` and `UserPromptSubmit` events, hook stdout is injected into the AI context as a `<system-reminder>` block. This allows hooks to dynamically provide instructions, context, or constraints to the model.

### Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "bash .hooks/validate-bash.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "bash .hooks/log-tool-use.sh" }]
      }
    ]
  }
}
```

Hooks have a 10-second timeout. Empty matcher matches all tools.

## Plugin Hooks

Plugins can define their own hooks in `hooks/hooks.json` within the plugin directory. Plugin hooks are merged into the session lifecycle alongside project-defined hooks.

### Environment Variables

Plugin hooks receive additional environment variables:

| Variable             | Description                       |
| -------------------- | --------------------------------- |
| `CLAUDE_PLUGIN_ROOT` | Root directory of the plugin      |
| `CLAUDE_PLUGIN_PATH` | Full path to the hook script      |
| `CLAUDE_PROJECT_DIR` | Current project working directory |
| `CLAUDE_SESSION_ID`  | Active session identifier         |

These environment variables use the `CLAUDE_` prefix for compatibility with Claude Code plugin conventions.

## Subagent Hook Forwarding

When a subagent session is created (via `createSubagentSession`), it inherits the parent session's hooks configuration. All hook events (`PreToolUse`, `PostToolUse`, etc.) fire in the subagent context with the same handlers as the parent. This ensures consistent policy enforcement across the parent and all spawned subagents.
