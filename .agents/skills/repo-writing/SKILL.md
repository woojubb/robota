---
name: repo-writing
description: Applies Robota's repository writing rules for `.design/`, general documentation, and conventional commit messages. Use when editing docs, ADRs, design notes, or preparing commit text.
---

# Repository Writing

## Rule Anchor
- `AGENTS.md` > "Language Policy"
- `AGENTS.md` > "Git Operations"
- `AGENTS.md` > "Rules and Skills Boundary"

## Use This Skill When
- Editing documentation or design notes.
- Writing or reviewing `.design/` documents.
- Preparing commit messages.
- Deciding whether generated docs should be edited directly.

## Preconditions
- Identify the target file path.
- Determine whether the file is under `.design/`.
- Determine whether the output is a document, generated file, or commit message.

## Execution Steps
1. Classify the target:
   - `.design/` document
   - general repository document
   - generated documentation
   - commit message
2. Apply the language rule:
   - `.design/` in Korean
   - repository documents outside `.design/` in English
   - commit messages in English
3. If the target is generated docs, update the source or generator instead of editing generated output directly.
4. If the target is a commit message, keep it in conventional commit format and focus on what changed for users or maintainers.
5. Keep examples and surrounding prose aligned with the target language of the document.

## Stop Conditions
- A `.design/` document is written in English.
- A non-`.design/` repository document is written in Korean.
- Generated docs are edited directly.
- A commit message is not in English or not in conventional format.

## Checklist
- [ ] Target path is classified correctly before writing.
- [ ] Language matches repository policy for that location.
- [ ] Generated docs are changed through sources, not direct edits.
- [ ] Commit messages use conventional commit format.
- [ ] Commit titles focus on outcome rather than implementation trivia.

## Focused Examples
```text
feat(agents): add ownerPath validation to tool execution
fix(dag-runtime): stop implicit retry after failed transition
docs(design): document harness migration phases
```

```text
.design/tmp/ -> Korean
packages/*/docs/ -> English
README.md -> English
```

## Anti-Patterns
- Mixing Korean and English policy arbitrarily in the same document class.
- Editing generated API reference files directly.
- Writing commit titles as implementation diary entries.
- Treating repository writing rules as optional style preferences.

## Related Harness Commands
- Current: repository policy review, docs generator commands
- Planned: `pnpm harness:scan`
