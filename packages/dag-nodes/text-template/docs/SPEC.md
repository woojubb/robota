# Text Template Node Specification

## Scope

- Owns the `text-template` DAG node definition.
- Provides deterministic text templating using `%s` placeholder substitution within DAG execution flows.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Uses `NodeIoAccessor.requireInputString` for input validation.
- No external provider dependencies. Category: `Core`.

## Architecture Overview

- `TextTemplateNodeDefinition` — node that accepts a `text` string input and produces a `text` string output after template substitution.
- Config includes a `template` field (defaults to `%s`). All `%s` occurrences in the template are replaced with the input text.
- Supports escaped `%%s` for literal `%s` in output (uses internal token replacement to avoid conflicts).
- Overrides `validateInputWithConfig` for early input string validation before execution.

## Type Ownership

| Type | Location | Purpose |
|------|----------|---------|
| `TextTemplateNodeDefinition` | `src/index.ts` | Node definition class |

## Public API Surface

- `TextTemplateNodeDefinition` — class

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `validateInputWithConfig`, `estimateCostWithConfig` (zero cost), and `executeWithConfig`.
- Config schema: `{ template: z.string().default('%s') }`.
- No constructor options. No environment variable dependencies.

## Error Taxonomy

| Code | Layer | Description |
|------|-------|-------------|
| `DAG_VALIDATION_INPUT_*` | Validation | Inherited from `NodeIoAccessor.requireInputString` when text input is missing or not a string |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests verifying `%s` substitution, `%%s` escape handling, default template pass-through, multiple `%s` replacements, and validation rejection for non-string input.
