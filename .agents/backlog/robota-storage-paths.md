# Robota Storage Paths

## What

Define and implement the `.robota/` directory structure as the canonical storage location for all Robota CLI data — settings, sessions, skills, plugins, agents.

## Why

Multiple features need persistent storage (settings, sessions, skills, plugins). A consistent directory convention must be established before building features that depend on it. Currently config-loader already uses `.robota/settings.json`, but the full directory structure is not formalized.

## Storage Structure

### Project Level (`.robota/` in project root)

```
.robota/
├── settings.json           ← project settings (shared, committed)
├── settings.local.json     ← local overrides (gitignored)
├── sessions/               ← session persistence files
│   └── {session_id}.json
├── skills/                 ← project-specific skills
│   └── {skill-name}/
│       └── SKILL.md
├── agents/                 ← project-specific agent definitions
│   └── {agent-name}.md
└── commands/               ← project-specific slash commands
    └── {command-name}.md
```

### User Level (`~/.robota/`)

```
~/.robota/
├── settings.json           ← user global settings
├── sessions/               ← global session storage
├── skills/                 ← user-level skills (all projects)
├── agents/                 ← user-level agent definitions
├── plugins/
│   ├── cache/              ← installed plugin files
│   │   └── {publisher}/{plugin-name}/{version}/
│   └── registry.json       ← installed plugins manifest
└── commands/               ← user-level slash commands
```

### Claude Code Compatibility (read-only)

When scanning for skills, also check these paths (read, not write):

- `.claude/skills/` — project-level Claude Code skills
- `~/.claude/skills/` — user-level Claude Code skills

## Scope

- Formalize `.robota/` directory structure in SDK spec
- Ensure config-loader uses `.robota/` consistently
- SessionStore uses `.robota/sessions/` (or `~/.robota/sessions/`)
- Add `.robota/settings.local.json` and `.robota/sessions/` to default .gitignore patterns
- Skill discovery scans `.robota/skills/` + `~/.robota/skills/` + Claude compat paths
- Document the structure in agent-sdk SPEC

## Priority

This should be implemented before slash menu (skill discovery depends on it) and before plugin system.
