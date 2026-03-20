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

Shell command-based lifecycle hooks. Defined in `agent-core`, consumed by `agent-sessions`.

### Events

| Event          | Timing                    | Purpose                         |
| -------------- | ------------------------- | ------------------------------- |
| `PreToolUse`   | Before tool execution     | Validation, blocking            |
| `PostToolUse`  | After tool execution      | Logging, auditing               |
| `PreCompact`   | Before context compaction | Validation                      |
| `PostCompact`  | After context compaction  | Notification (includes summary) |
| `SessionStart` | Session initialization    | Setup                           |
| `Stop`         | Session termination       | Cleanup                         |

### Exit Code Protocol

| Code  | Meaning                        |
| ----- | ------------------------------ |
| 0     | Allow / proceed                |
| 2     | Block / deny (stderr = reason) |
| other | Proceed with warning           |

### Hook Input

Hooks receive JSON via stdin:

```json
{
  "session_id": "session_1234",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "pnpm test" }
}
```

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
