# Interactive Mode

The CLI TUI provides a full-featured terminal AI coding assistant.

## Starting

```bash
robota                    # Start empty
robota "Fix the bug"      # Start with initial prompt
robota -c                 # Continue last session
robota -r session_123     # Resume specific session
```

## Features

### Slash Commands

Type `/` to see all available commands. The autocomplete popup filters as you type.

```
/help         Show available commands
/mode plan    Switch to plan mode (read-only)
/model        Show model selection submenu
/compact      Compress context with default instructions
/compact focus on API changes    Compress with custom focus
/context      Show detailed context usage
/clear        Clear history and start fresh
/resume       Resume a previous session
/rename name  Rename the current session
/reload-plugins  Reload all plugins
```

### Permission Prompts

When a tool requires approval (in `default` mode), an arrow-key prompt appears:

```
Bash: pnpm test
  ▸ Allow once
    Allow for session
    Deny
```

### Context Status

The status bar shows real-time context usage:

```
Mode: default | Model: claude-sonnet-4-6 | Context: 45% | msgs: 12
```

Colors: green (0-69%), yellow (70-89%), red (90%+).

### Tab Completion

```
Tab: Insert command into input (without executing)
Enter: Execute immediately
```

### Session Name

The session name appears in three places: input box border, terminal title, and status bar.

### Skill Commands

Project skills from `.agents/skills/` appear as additional slash commands, separated from built-in commands.
