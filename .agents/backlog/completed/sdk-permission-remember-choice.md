# Permission Remember Choice

## What

When a tool execution requires approval, add a "Allow and don't ask again" option so the user can approve the tool for the rest of the session without being prompted every time.

## Why

Currently every tool call that requires approval prompts the user. For repetitive tool usage (e.g., multiple Bash commands), this becomes tedious. Claude Code offers "yes don't ask" to auto-approve for the session.

## Scope

- Add "Allow always (this session)" option to permission prompt (3rd choice alongside Allow/Deny)
- Store session-scoped allow rules in memory (not persisted to disk)
- When a tool+pattern is session-allowed, skip the prompt and auto-approve
- Apply to both CLI (PermissionPrompt component) and SDK (permissionHandler)
- Session-scoped only — rules reset on new session
- Show currently auto-approved tools via `/permissions` slash command
