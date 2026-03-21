---
title: Expand edit tool test coverage
status: completed
priority: medium
created: 2026-03-20
packages:
  - agent-tools
  - agent-sdk
---

# Expand edit tool test coverage

## Goal

The edit tool has 7 basic tests but is missing edge cases that affect correctness in real usage. Add tests to verify precise behavior.

## Existing Coverage (7 tests)

- Unique string replacement
- oldString not found → error
- oldString not unique → error with count
- replaceAll
- Missing file → error
- Multiline replacement
- replaceAll occurrence count

## Missing Cases

- Indentation preservation (tabs, spaces) — verify surrounding whitespace untouched
- oldString === newString — should succeed or no-op?
- Empty oldString / empty newString
- Precise position — only the matched location changes, surrounding content preserved exactly
- Special characters (regex metacharacters: `.`, `*`, `(`, `[`, `$`, etc.)
- Unicode / Korean characters
- Large file correctness
- oldString at file start / file end
- Trailing newline preservation
- Windows line endings (CRLF)
