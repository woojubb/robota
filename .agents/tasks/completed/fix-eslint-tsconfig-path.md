---
title: Fix ESLint tsconfig path error in agent-core
status: completed
priority: medium
created: 2026-03-20
packages:
  - agent-core
---

# Fix ESLint tsconfig path error in agent-core

## Problem

`pnpm lint` fails in agent-core with:

```
0:0 error Parsing error: Cannot read file 'packages/agent-core/tsconfig.json'
```

This has existed since `c1c3e877` (package rename refactoring). ESLint's TypeScript parser cannot resolve the tsconfig path. All other packages are unaffected.

## Impact

- `pnpm lint` exits non-zero, blocking the publish safety gate
- Currently bypassed during publish (beta.3 was published with this issue)

## Likely Fix

ESLint config (`parserOptions.project`) needs to point to the correct tsconfig path relative to where ESLint runs. Check `.eslintrc` or `eslint.config` for the project field.
