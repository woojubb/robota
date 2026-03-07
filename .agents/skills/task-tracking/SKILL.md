---
name: task-tracking
description: Track work using task files in .agents/tasks/. Use when starting, progressing, or completing a task to maintain a persistent record of work.
---

# Task Tracking

## Rule Anchor
- `AGENTS.md` > "Harness Operating Model"

## Use This Skill When
- Starting a new task or feature that involves multiple steps.
- Resuming work from a previous session.
- Completing a task and archiving the record.

## Directory Structure

```
.agents/tasks/
├── <task-name>.md          # Active tasks
└── completed/
    └── <task-name>.md      # Completed/archived tasks
```

## Task File Format

```markdown
# <Task Title>

- **Status**: todo | in-progress | blocked | completed
- **Created**: YYYY-MM-DD
- **Branch**: feat/xxx (if applicable)
- **Scope**: packages/foo, apps/bar

## Objective
What this task aims to achieve (1-3 sentences).

## Plan
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

## Progress
### YYYY-MM-DD
- Completed step 1
- Started step 2

## Decisions
- Chose approach A over B because ...

## Blockers
- (none, or describe current blockers)

## Result
(Filled when completed — summary of what was done and any follow-up items.)
```

## Execution Steps

### Starting a Task

1. Create `.agents/tasks/<task-name>.md` using the format above.
   - Use a descriptive kebab-case name: `agents-test-coverage`, `dag-core-refactor`, `harness-cleanup`.
   - Set status to `in-progress`.
   - Write the objective and initial plan.

2. If the task requires a branch, follow the `branch-guard` skill.

### During a Task

3. Update the Progress section with dated entries as milestones are reached.
4. Update the Plan checklist — check off completed items, add new items as discovered.
5. Record key decisions in the Decisions section.
6. Note any blockers in the Blockers section.

### Completing a Task

7. Set status to `completed`.
8. Fill the Result section with a summary and any follow-up items.
9. Move the file to `completed/`:
   ```bash
   mv .agents/tasks/<task-name>.md .agents/tasks/completed/<task-name>.md
   ```
10. Commit the moved file with the relevant changes.

### Resuming a Task

11. Check `.agents/tasks/` for active task files.
12. Read the task file to restore context.
13. Continue from the last progress entry.

## Naming Convention

- `<scope>-<description>.md` — e.g., `agents-test-coverage.md`, `harness-spec-expansion.md`
- Keep names short but descriptive.
- No date prefix needed — the Created field inside the file tracks this.

## Stop Conditions

- Do not create task files for trivial, single-step changes (e.g., fixing a typo).
- Do not create multiple task files for the same work.
- Do not leave completed tasks in the active directory.

## Checklist

- [ ] Task file created in `.agents/tasks/`
- [ ] Objective and plan written
- [ ] Progress updated at milestones
- [ ] Status reflects current state
- [ ] Moved to `completed/` when done
- [ ] Result section filled before archiving

## Anti-Patterns

- Creating a task file but never updating it.
- Leaving completed tasks in the active directory indefinitely.
- Writing excessively detailed progress (keep it concise — milestones, not play-by-play).
- Creating task files for work that fits in a single commit.
