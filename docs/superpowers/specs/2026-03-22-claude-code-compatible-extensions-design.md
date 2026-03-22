# Claude Code Compatible Extensions Design

## Overview

Implement four Claude Code-compatible extension systems in Robota CLI so that Claude Code ecosystem resources (skills, plugins, hooks, commands) work natively. The `.claude/` directory format takes priority; `.agents/` directory is also supported for forward compatibility. (Note: `.agents/` is the current Robota convention. A future `.agent/` singular standard may be adopted separately.)

**Implementation order**: Skill/Command → Hook → BundlePlugin → Marketplace

## 1. Skill/Command

### Scan Paths (Priority Order)

1. `.claude/skills/` (project)
2. `.claude/commands/` (project, legacy)
3. `~/.robota/skills/` (user)
4. `.agents/skills/` (project)
5. `~/.robota/plugins/*/skills/` (installed plugins, namespaced)

When duplicate `name` is found, higher-priority source wins. Extends the existing `SkillCommandSource` in agent-cli.

### Frontmatter Schema (Claude Code Standard)

```yaml
---
name: my-skill
description: When and how to use this skill
argument-hint: [file] [options]
disable-model-invocation: true
user-invocable: false
allowed-tools: Read, Grep, Bash
model: claude-sonnet-4-20250514
effort: high
context: fork
agent: Explore
hooks: { ... }
---
```

Current Robota parses only `name` and `description`. Upgrade the parser to support the full Claude Code frontmatter schema.

### Variable Substitution

- `$ARGUMENTS` — all arguments passed to the skill
- `$ARGUMENTS[N]` — argument by index (0-based)
- `$N` — shorthand for `$ARGUMENTS[N]`
- `${CLAUDE_SESSION_ID}` — current session ID
- `${CLAUDE_SKILL_DIR}` — directory containing SKILL.md
- `` !`command` `` — shell command output (preprocessed before sending to AI)

### Execution Features

- `context: fork` — run in isolated subagent context
- `allowed-tools` — permission control for the skill execution
- `agent: Explore|Plan|general-purpose` — subagent type selection

### Invocation Methods

| Method                | Description                                  | Control Field                             |
| --------------------- | -------------------------------------------- | ----------------------------------------- |
| **User direct**       | `/skill-name` slash command                  | Default behavior                          |
| **Model auto-invoke** | AI reads `description` and decides to invoke | `disable-model-invocation: true` to block |
| **Model-only**        | Hidden from `/` menu, only AI can invoke     | `user-invocable: false`                   |

### System Prompt Injection

Discovered skills are injected into the system prompt as a name + description list:

```
The following skills are available:

- skill-name: description text here
- another-skill: another description
```

- Skills with `disable-model-invocation: true` are excluded from the list
- Skills with `user-invocable: false` are excluded from the `/` menu but included in the system prompt

## 2. Hook

### Configuration Sources (Priority Order)

1. `.claude/settings.local.json` (project, gitignored)
2. `.claude/settings.json` (project)
3. `~/.robota/settings.json` (user)
4. Installed plugin `hooks/hooks.json`

### Configuration Format (Claude Code Standard)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit",
        "hooks": [{ "type": "command", "command": "./guard.sh", "timeout": 10 }]
      }
    ]
  }
}
```

### Supported Events

Phase 1 (existing runner + high-usage additions):

| Event              | Status                      | Notes                          |
| ------------------ | --------------------------- | ------------------------------ |
| `SessionStart`     | Runner implemented, unwired | Wire to session initialization |
| `UserPromptSubmit` | **New**                     | Before AI processes user input |
| `PreToolUse`       | Runner implemented, unwired | Exit code 2 = block tool call  |
| `PostToolUse`      | Runner implemented, unwired |                                |
| `Stop`             | Runner implemented, unwired | AI response complete           |
| `Notification`     | **New**                     | On notification events         |
| `PreCompact`       | Runner implemented, unwired |                                |
| `PostCompact`      | Runner implemented, unwired |                                |

Remaining Claude Code events (13 more) can be added incrementally.

### Hook Types (All Four)

| Type      | Impl. Layer | Description                                                                                    |
| --------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `command` | agent-core  | Shell command execution. stdin receives JSON input, exit codes control flow (0=allow, 2=block) |
| `http`    | agent-core  | HTTP POST to endpoint. Supports environment variable interpolation in headers                  |
| `prompt`  | agent-sdk   | Single-turn LLM evaluation. Returns `{"ok": true/false, "reason": "..."}`                      |
| `agent`   | agent-sdk   | Multi-turn subagent with file/command access. Up to 50 tool turns, 60s timeout                 |

**Package boundary**: `command` and `http` are pure I/O — implemented in agent-core. `prompt` and `agent` require AI provider access — implemented in agent-sdk. agent-core exposes a `IHookTypeExecutor` strategy interface; agent-sdk registers executors for `prompt` and `agent` types via dependency injection.

### Hook Type Definitions (Discriminated Union)

```typescript
type IHookDefinition =
  | { type: 'command'; command: string; timeout?: number }
  | { type: 'http'; url: string; headers?: Record<string, string>; timeout?: number }
  | { type: 'prompt'; prompt: string; model?: string }
  | { type: 'agent'; agent: string; maxTurns?: number; timeout?: number };
```

Timeout values are in **seconds** (Claude Code convention). Default: 10s for `command`/`http`, 60s for `agent`.

### Hook Input Schema

```json
{
  "session_id": "unique_session_id",
  "cwd": "/current/working/directory",
  "hook_event_name": "EventName",
  "tool_name": "ToolName",
  "tool_input": {}
}
```

### Hook Event Type Ownership

`THookEvent` in agent-core is the SSOT for all event names. New events (`UserPromptSubmit`, `Notification`) are added to `THookEvent`. Wiring happens at whatever layer the event originates — agent-sdk passes hook config to agent-core's runner via DI at construction time.

### Wiring Points

| Event                        | Origin Layer | Connection Point                                              |
| ---------------------------- | ------------ | ------------------------------------------------------------- |
| `SessionStart`               | agent-sdk    | Session initialization                                        |
| `UserPromptSubmit`           | agent-sdk    | Before input processing                                       |
| `PreToolUse` / `PostToolUse` | agent-core   | Tool execution service (hook config injected via constructor) |
| `Stop`                       | agent-sdk    | AI response completion                                        |
| `PreCompact` / `PostCompact` | agent-sdk    | Context compaction                                            |
| `Notification`               | agent-cli    | Notification emission                                         |

**DI mechanism**: agent-sdk loads hook config from settings files, then passes the merged config to agent-core services via constructor injection. agent-core never reads settings files directly.

## 3. BundlePlugin

### Naming

- **`BundlePlugin`** — lives in `agent-sdk`
- Distinct from `agent-core`'s `AbstractPlugin` (runtime code-level extension)
- A BundlePlugin is a directory-based distribution unit that bundles skills, commands, hooks, agents, and MCP servers

### Directory Structure (Claude Code Standard)

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json          # Metadata, feature declarations
├── commands/                # Legacy slash commands (.md)
├── skills/                  # Skill definitions (SKILL.md)
├── agents/                  # Custom agent definitions
├── hooks/
│   └── hooks.json           # Plugin-specific hooks
├── .mcp.json                # MCP server configuration
└── README.md
```

### Installation Scopes

| Scope   | Path                                           | Applies To        |
| ------- | ---------------------------------------------- | ----------------- |
| User    | `~/.robota/plugins/`                           | All projects      |
| Project | `.claude/settings.json` `enabledPlugins`       | All collaborators |
| Local   | `.claude/settings.local.json` `enabledPlugins` | Local only        |

Note: `~/.claude/` is never used by Robota. All user-level storage uses `~/.robota/`.

### Plugin Settings Persistence

All plugin-related settings are persisted to `~/.robota/settings.json` via a shared `PluginSettingsStore`. This store is the single point of read/write for:

- `enabledPlugins` — which plugins are enabled/disabled
- `extraKnownMarketplaces` — user-added marketplace sources

`MarketplaceClient` and `BundlePluginInstaller` both receive the same `PluginSettingsStore` instance via DI, preventing concurrent write conflicts.

### Plugin Management Commands

```
/plugin install <name>@<marketplace>
/plugin uninstall <name>@<marketplace>
/plugin enable <name>@<marketplace>
/plugin disable <name>@<marketplace>
/reload-plugins
```

### Plugin Load Behavior

When a plugin is loaded, its contents are merged into the respective systems:

1. `skills/` → skill discovery list (namespaced as `skill-name@plugin-name`)
2. `hooks/hooks.json` → hook configuration merge
3. `.mcp.json` → MCP server connections
4. `agents/` → registered as available agent types

### Package Responsibilities

| Package        | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| **agent-core** | `AbstractPlugin` — runtime plugin infrastructure                        |
| **agent-sdk**  | `BundlePlugin` — directory-based plugin discovery, install, load, merge |
| **agent-cli**  | `/plugin` command UI                                                    |

Dependency direction: `cli → sdk → core`

## 4. Marketplace

### Source Types

| Type       | Example                                  |
| ---------- | ---------------------------------------- |
| GitHub     | `anthropics/claude-code` (owner/repo)    |
| Git URL    | `https://gitlab.com/company/plugins.git` |
| Local path | `./my-marketplace`                       |
| Remote URL | `https://example.com/marketplace.json`   |

### Configuration

```json
{
  "enabledPlugins": {
    "plugin-name@marketplace-name": true
  },
  "extraKnownMarketplaces": {
    "my-team": {
      "source": { "source": "github", "repo": "org/plugins" }
    }
  }
}
```

### Management Commands

```
/plugin marketplace add <source>
/plugin marketplace remove <name>
/plugin marketplace list
/plugin marketplace update <name>
/plugin install <name>@<marketplace>
```

### Marketplace Subcommand Behavior

| Subcommand      | Behavior                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `add <source>`  | Shallow-clone the marketplace repo, read manifest `name` field, register under that name. No plugins installed yet. |
| `remove <name>` | Remove the marketplace clone AND uninstall all plugins installed from it.                                           |
| `list`          | List all registered marketplaces with source type.                                                                  |
| `update <name>` | Git pull the marketplace clone, re-read manifest, update installed plugins to latest versions.                      |

### Default Marketplace

Register Claude Code's `claude-plugins-official` as the default marketplace, enabling direct installation and usage of Claude Code ecosystem plugins.

### Marketplace and Plugin Installation Flow

#### Directory Layout

```
~/.robota/plugins/
├── marketplaces/
│   └── <marketplace-name>/          # Shallow git clone of marketplace repo
│       ├── .claude-plugin/
│       │   └── marketplace.json     # Plugin catalog
│       └── packages/               # Plugin subdirectories (relative paths)
├── cache/
│   └── <marketplace-name>/
│       └── <plugin-name>/
│           └── <version>/           # Extracted plugin (skills, hooks, etc.)
├── installed_plugins.json           # Tracks installed plugins
└── known_marketplaces.json          # Registry of added marketplaces
```

#### `marketplace add` Flow

1. Parse source: `owner/repo` → GitHub, URL → direct
2. Shallow git clone (`--depth 1`) to `~/.robota/plugins/marketplaces/<name>/`
3. Read `.claude-plugin/marketplace.json` for the `name` field
4. Register in `known_marketplaces.json` with source, installLocation, timestamp

#### `plugin install` Flow

1. Parse `<plugin-name>@<marketplace-name>`
2. Look up marketplace in `known_marketplaces.json`
3. Git pull the marketplace clone (update to latest)
4. Read `marketplace.json`, find plugin entry by name
5. Resolve source — three types:
   - `"./relative/path"` (string): plugin lives inside the marketplace repo. Copy from marketplace clone.
   - `{ "type": "github", "repo": "..." }`: separate git repo. Clone independently.
   - `{ "type": "url", "url": "..." }`: fetch from URL.
6. Determine version: explicit `version` field from manifest, or 12-char git commit SHA as fallback
7. Copy plugin to `~/.robota/plugins/cache/<marketplace>/<plugin>/<version>/`
8. Record in `installed_plugins.json`

#### Plugin Source Types in Manifest

| Source format                               | Meaning                               | Install behavior            |
| ------------------------------------------- | ------------------------------------- | --------------------------- |
| `"./packages/foo"`                          | Relative path inside marketplace repo | Copy from marketplace clone |
| `{ "type": "github", "repo": "user/repo" }` | Separate GitHub repo                  | Clone independently         |
| `{ "type": "url", "url": "https://..." }`   | Remote URL                            | Fetch and extract           |

### Marketplace Manifest Format

```json
{
  "name": "marketplace-id",
  "version": "1.4.9",
  "description": "Description of this marketplace",
  "plugins": [
    {
      "name": "plugin-id",
      "description": "What this plugin does",
      "source": "./packages/plugin-id",
      "version": "1.0.0",
      "category": "development"
    }
  ]
}
```

Note: `source` can be a relative path string (most common) or an object with `type`/`repo`/`url` fields.

## Architecture Summary

```
┌─────────────────────────────────────────────────┐
│ agent-cli                                        │
│  ├── /skill-name (slash commands)                │
│  ├── /plugin (install/enable/disable/uninstall)  │
│  ├── /plugin marketplace (add/list/update)       │
│  └── System prompt injection (skill list)        │
├─────────────────────────────────────────────────┤
│ agent-sdk                                        │
│  ├── BundlePlugin (discovery, install, load)     │
│  ├── PluginSettingsStore (shared settings I/O)   │
│  ├── Marketplace (source management, fetch)      │
│  ├── Skill/Command discovery (multi-path scan)   │
│  ├── Hook config loader (settings.json merge)    │
│  ├── Hook wiring (session, tool, compaction)     │
│  └── Hook type executors (prompt, agent via DI)  │
├─────────────────────────────────────────────────┤
│ agent-core                                       │
│  ├── Hook runner (command, http + IHookTypeExecutor strategy) │
│  ├── THookEvent (SSOT for all event names)       │
│  ├── AbstractPlugin (runtime plugins)            │
│  └── EventEmitter (lifecycle events)             │
└─────────────────────────────────────────────────┘
```

## Scan Path Summary

| System          | Paths (priority order)                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| **Skills**      | `.claude/skills/` → `.claude/commands/` → `~/.robota/skills/` → `.agents/skills/` → plugin `skills/`      |
| **Hooks**       | `.claude/settings.local.json` → `.claude/settings.json` → `~/.robota/settings.json` → plugin `hooks.json` |
| **Plugins**     | `~/.robota/plugins/` + `enabledPlugins` in settings                                                       |
| **Marketplace** | `claude-plugins-official` (default) + `extraKnownMarketplaces` in settings                                |

## Remaining Claude Code Events (Deferred)

The following 13 events are not in Phase 1 but can be added incrementally:

`PostToolUseFailure`, `PermissionRequest`, `StopFailure`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCompleted`, `InstructionsLoaded`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `Elicitation`, `ElicitationResult`, `SessionEnd`

## Future Direction

The `.claude/` format takes priority now, but the `.agents/` standard is also supported. A future `.agent/` singular standard may be adopted. The discovery layer supports multiple paths, so transitioning priority requires only path ordering changes.
