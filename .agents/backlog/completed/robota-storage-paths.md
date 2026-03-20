# Robota Storage Paths

## What

Define `.robota/` directory as Robota CLI runtime-only storage. Respect existing `.agents/` and `AGENTS.md`/`CLAUDE.md` standards — do not duplicate or replace them.

## Principle

- `.agents/` owns project structure: skills, tasks, rules, specs, backlog
- `AGENTS.md` / `CLAUDE.md` own project instructions
- `.robota/` owns CLI runtime data only: settings, sessions, plugin cache
- No `.robota/skills/` — skills live in `.agents/skills/`

## Storage Structure

### Project Level (`.robota/`)

```
.robota/
├── settings.json           ← CLI settings (shared, committed)
├── settings.local.json     ← local overrides (gitignored)
├── logs/                   ← session event logs (gitignored)
│   └── {session_id}.jsonl
└── sessions/               ← session persistence files (gitignored)
    └── {session_id}.json
```

### User Level (`~/.robota/`)

```
~/.robota/
├── settings.json           ← user global CLI settings
├── sessions/               ← global session storage
└── plugins/
    ├── cache/              ← installed plugin files (future)
    └── registry.json       ← installed plugins manifest (future)
```

### Existing Paths (not owned by .robota/, read-only)

| Path                | Owner              | Used by CLI for                        |
| ------------------- | ------------------ | -------------------------------------- |
| `.agents/skills/`   | AGENTS.md standard | Skill discovery for slash menu         |
| `.agents/tasks/`    | AGENTS.md standard | Task tracking hooks                    |
| `AGENTS.md`         | Project standard   | Context loading                        |
| `CLAUDE.md`         | Project standard   | Context loading + Compact Instructions |
| `~/.claude/skills/` | Claude Code compat | Additional skill discovery (read-only) |

## Scope

- Formalize `.robota/` as runtime-only storage in SDK spec
- Ensure config-loader uses `.robota/` for settings (already does)
- SessionStore uses `~/.robota/sessions/`
- Add `.robota/settings.local.json`, `.robota/sessions/`, `.robota/logs/` to gitignore
- Skill discovery scans `.agents/skills/` (primary) + `~/.claude/skills/` (compat)
- Document the boundary in agent-sdk SPEC

## Priority

Implement before slash menu (skill discovery path must be defined).
