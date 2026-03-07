---
name: commit-message-guidance
description: Provide commit message examples and guidance focused on WHAT changed, not HOW. Use when helping write commit messages or when the user asks for commit format help.
---

# Commit Message Guidance

## Rule Anchor
- `AGENTS.md` > "Git Operations"
- `AGENTS.md` > "Language Policy"

## Scope
Use this skill to help craft concise, conventional commit messages that focus on WHAT was accomplished.

## Guidance
- Prefer user-facing outcomes over implementation details.
- Use imperative mood (e.g., "Add", "Fix", "Update").
- Keep the title concise and under 80 characters.

## Questions to Ask Yourself
1. What new capability does this give users?
2. What problem does this solve?
3. What can someone do now that they couldn't before?

## Examples
**Good:**
- `feat: add streaming chat responses`
- `fix: resolve authentication failures`
- `refactor: simplify provider configuration`

**Avoid (too technical):**
- `feat: implement Facade pattern with atomic types`
- `refactor: split code into pure functions`
- `feat: add TypeScript interfaces and validation`

## Common Action Verbs
- Add, Fix, Remove, Improve, Update, Refactor, Optimize
