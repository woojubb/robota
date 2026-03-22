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
---
```

Note: The `hooks` frontmatter field (YAML object) is not supported in the simple parser. Plugin hooks are configured via `hooks/hooks.json` instead.

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

Execution is implemented via a callback interface (`ISkillExecutionCallbacks`) in agent-cli. The `executeSkill` function checks frontmatter fields and delegates:

- **Non-fork skills** (default): skill content is returned as a prompt string for injection into the current session.
- **Fork skills** (`context: fork`): skill content, `agent` type, and `allowedTools` are passed to a `runInFork` callback. The actual subagent infrastructure is provided by the caller.

Note: The `runInFork` callback must be wired by the application layer. Without it, fork skills fall back to inject mode.

### Invocation Methods

| Method                | Description                                          | Control Field                             |
| --------------------- | ---------------------------------------------------- | ----------------------------------------- |
| **User direct**       | `/skill-name` slash command                          | Default behavior                          |
| **Model auto-invoke** | AI suggests `/skill-name` in response, user executes | `disable-model-invocation: true` to block |
| **Model-only**        | Hidden from `/` menu, only AI can invoke             | `user-invocable: false`                   |

Note: Model auto-invoke works by injecting skill descriptions into the system prompt. The AI can suggest `/skill-name` in its response text, which the user can then execute. True programmatic invoke via tool registration (as in Claude Code's Skill tool) is deferred.

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

### Configuration Sources (Priority Order, highest first)

1. `.claude/settings.local.json` (project, gitignored) — highest
2. `.claude/settings.json` (project)
3. `.robota/settings.local.json` (project, gitignored)
4. `.robota/settings.json` (project)
5. `~/.robota/settings.json` (user) — lowest

Plugin `hooks/hooks.json` is loaded separately by `BundlePluginLoader` and merged at the SDK level, not via the config-loader.

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

| Event              | Status                      | Notes                                                              |
| ------------------ | --------------------------- | ------------------------------------------------------------------ |
| `SessionStart`     | Runner implemented, unwired | Wire to session initialization                                     |
| `UserPromptSubmit` | **New**                     | Before AI processes user input                                     |
| `PreToolUse`       | Runner implemented, unwired | Exit code 2 = block tool call                                      |
| `PostToolUse`      | Runner implemented, unwired |                                                                    |
| `Stop`             | Runner implemented, unwired | AI response complete                                               |
| `Notification`     | Defined, not yet wired      | On notification events (deferred until notification system exists) |
| `PreCompact`       | Runner implemented, unwired |                                                                    |
| `PostCompact`      | Runner implemented, unwired |                                                                    |

Remaining Claude Code events (13 more) can be added incrementally.

### Hook Stdout Injection

For `SessionStart` and `UserPromptSubmit` hooks, the stdout output from successfully executed hooks (exit code 0) is collected and injected into the AI's context as a `<system-reminder>` message. This allows hooks to provide dynamic information to the AI (e.g., plugin paths, environment state, task lists).

- `runHooks` returns collected stdout along with the blocked/reason result.
- The session injects non-empty stdout as a system-level context addition before the AI processes input.
- Other hook events (`PreToolUse`, `PostToolUse`, `Stop`, etc.) do NOT inject stdout.

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
  "tool_input": {},
  "prompt": "user message text (UserPromptSubmit only, Claude Code compat)"
}
```

For `UserPromptSubmit`, the `prompt` field contains the **raw user input** (e.g., `/rulebased-harness:audit`), not the processed skill content. This matches Claude Code's hook input format where scripts read `"prompt"` to determine what the user typed. The raw input is passed separately from the processed message via `session.run(processedMessage, rawInput)`.

### Hook + Skill Interaction

When a user invokes a plugin skill/command:

1. **Name resolution**: If the user types `/audit` (skill short name), `CommandRegistry.resolveQualifiedName()` maps it to the full qualified name `/rulebased-harness:audit` (command form). This is needed because hook scripts pattern-match on the qualified name.
2. `session.run(processedSkillContent, qualifiedRawInput)` is called
3. `UserPromptSubmit` hook fires with `prompt: qualifiedRawInput` in stdin JSON
4. Hook scripts can match the qualified command and produce stdout (e.g., plugin paths)
5. Hook stdout is prepended as `<system-reminder>` to the processed message
6. AI receives: `<system-reminder>{hook stdout}</system-reminder>\n{skill content}`

### Skill Name Resolution

`CommandRegistry` provides `resolveQualifiedName(shortName)` to map skill short names to their plugin-qualified command names:

- Input: `audit` → Output: `rulebased-harness:audit` (if a command `rulebased-harness:audit` exists)
- Input: `rulebased-harness:audit` → Output: `rulebased-harness:audit` (already qualified)
- Input: `unknown` → Output: `null` (no match)

If multiple plugins have commands ending with the same short name, the resolution is ambiguous and returns `null`. The caller falls back to the original input.

### Plugin Environment Variables

Hook scripts and plugin processes receive these environment variables:

| Variable             | Description                                                                        | Provided by                              |
| -------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| `CLAUDE_PLUGIN_ROOT` | Absolute path to the plugin's installation directory                               | Set per-plugin when running plugin hooks |
| `CLAUDE_PLUGIN_DATA` | Persistent data directory for plugin state (`~/.robota/plugins/data/<plugin-id>/`) | Set per-plugin, created on first use     |
| `CLAUDE_PROJECT_DIR` | Absolute path to the project root directory                                        | Set globally for all hooks               |
| `CLAUDE_SESSION_ID`  | Current session ID                                                                 | Set globally for all hooks               |
| `CLAUDE_PLUGIN_PATH` | Same as `CLAUDE_PLUGIN_ROOT` (alias for compatibility)                             | Set per-plugin                           |

These are set as environment variables on the child process when executing hook commands. `${CLAUDE_PLUGIN_ROOT}` is also substituted inline in hook command strings before execution.

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
│ └── plugin.json # Metadata, feature declarations
├── commands/ # Legacy slash commands (.md)
├── skills/ # Skill definitions (SKILL.md)
├── agents/ # Custom agent definitions
├── hooks/
│ └── hooks.json # Plugin-specific hooks
├── .mcp.json # MCP server configuration
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

Plugin-related data is split across two persistence mechanisms:

1. **`PluginSettingsStore`** (`~/.robota/settings.json`): manages `enabledPlugins` (which plugins are enabled/disabled) and `extraKnownMarketplaces` (user-added marketplace sources for settings sync). `BundlePluginInstaller` uses this store for enable/disable state.

2. **`MarketplaceClient`** (`~/.robota/plugins/known_marketplaces.json`): manages the marketplace registry independently, tracking clone locations and update timestamps. This file is the operational registry for marketplace CRUD operations.

The two stores serve different purposes: `PluginSettingsStore` is the user-facing settings layer (synced across settings files), while `MarketplaceClient` manages the operational state of marketplace clones.

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

1. `skills/` → Each subdirectory containing `SKILL.md` is loaded as a skill. Displayed as `/skill-name` with a `(plugin-name)` hint in the menu.
2. `commands/` → Each `.md` file is loaded as a command. Displayed as `/plugin-name:command-name` in the menu (Claude Code convention).
3. `hooks/hooks.json` → hook configuration merge
4. `.mcp.json` → MCP server connections
5. `agents/` → registered as available agent types

### Plugin Slash Command Display Format

| Type    | Directory                | Display in `/` menu   | Example                     |
| ------- | ------------------------ | --------------------- | --------------------------- |
| Skill   | `skills/<name>/SKILL.md` | `/name (plugin-name)` | `/init (rulebased-harness)` |
| Command | `commands/<name>.md`     | `/plugin-name:name`   | `/rulebased-harness:init`   |

Skills and commands from plugins are distinguished by their display format. Skills use parenthetical plugin hints; commands use the `plugin:command` colon convention (matching Claude Code's behavior).

### Package Responsibilities

| Package        | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| **agent-core** | `AbstractPlugin` — runtime plugin infrastructure                        |
| **agent-sdk**  | `BundlePlugin` — directory-based plugin discovery, install, load, merge |
| **agent-cli**  | `/plugin` command UI                                                    |

Dependency direction: `cli → sdk → core`

## 4. Marketplace

### Source Types

| Type       | Example                                  | Status      |
| ---------- | ---------------------------------------- | ----------- |
| GitHub     | `anthropics/claude-code` (owner/repo)    | Implemented |
| Git URL    | `https://gitlab.com/company/plugins.git` | Implemented |
| Local path | `./my-marketplace`                       | Implemented |
| Remote URL | `https://example.com/marketplace.json`   | Phase 2     |

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

No default marketplace is pre-registered. Users add marketplaces explicitly via `/plugin marketplace add <source>`.

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

| Source format                               | Meaning                               | Install behavior            | Status      |
| ------------------------------------------- | ------------------------------------- | --------------------------- | ----------- |
| `"./packages/foo"`                          | Relative path inside marketplace repo | Copy from marketplace clone | Implemented |
| `{ "type": "github", "repo": "user/repo" }` | Separate GitHub repo                  | Clone independently         | Implemented |
| `{ "type": "url", "url": "https://..." }`   | Remote URL                            | Fetch and extract           | Phase 2     |

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
      "category": "development",
      "tags": ["optional", "tags"]
    }
  ]
}
```

Plugin entry fields:

- `name` (required): Plugin identifier
- `description` (required): What this plugin does
- `source` (required): Relative path string (e.g., `"./packages/foo"`) or source object (`{ "type": "github", "repo": "..." }`)
- `version` (optional): Semver string. If absent, 12-char git SHA is used as version key
- `category` (optional): Plugin category (e.g., "development", "productivity")
- `tags` (optional): Additional tags for search/filtering

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

| System          | Paths (priority order)                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skills**      | `.claude/skills/` → `.claude/commands/` → `~/.robota/skills/` → `.agents/skills/` → plugin `skills/`                                                                                  |
| **Hooks**       | `.claude/settings.local.json` → `.claude/settings.json` → `.robota/settings.local.json` → `.robota/settings.json` → `~/.robota/settings.json` (plugin `hooks.json` merged separately) |
| **Plugins**     | `~/.robota/plugins/` + `enabledPlugins` in settings                                                                                                                                   |
| **Marketplace** | No default. User-added via `extraKnownMarketplaces` in settings                                                                                                                       |

## Remaining Claude Code Events (Deferred)

The following 13 events are not in Phase 1 but can be added incrementally:

`PostToolUseFailure`, `PermissionRequest`, `StopFailure`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCompleted`, `InstructionsLoaded`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `Elicitation`, `ElicitationResult`, `SessionEnd`

## Future Direction

The `.claude/` format takes priority now, but the `.agents/` standard is also supported. A future `.agent/` singular standard may be adopted. The discovery layer supports multiple paths, so transitioning priority requires only path ordering changes.
