---
name: plugin-development
description: Guide plugin development workflows with validation, disable strategies, and error handling. Use when working on plugin development, plugin system changes, or plugin options validation.
---

# Plugin Development

## Rule Anchor
- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Rules and Skills Boundary"

## Scope
Use this skill for designing or updating plugins in the project plugin system.

## Preconditions
- A plugin base type exists (e.g., a BasePlugin abstraction).
- Plugin options are validated at construction time.
- Error handling uses the project-standard plugin error type.

## Workflow
1. **Define plugin identity**
   - Set a stable name and version.
2. **Validate options early**
   - Validate constructor options and strategy flags.
   - Return actionable errors with context.
3. **Provide disable controls**
   - Support `enabled: false`.
   - Support `strategy: 'silent'` or `strategy: 'none'`.
4. **Implement core behavior**
   - Keep behavior deterministic and configurable.
5. **Document usage**
   - Add usage examples and configuration notes.

## Checklist
- [ ] Name and version are defined.
- [ ] Options validation runs in the constructor.
- [ ] Disable controls are available and tested.
- [ ] Error messages include context and actionable guidance.
- [ ] Configuration examples are documented.

## References
- Plugin guide: `packages/agents/docs/PLUGINS.md`
