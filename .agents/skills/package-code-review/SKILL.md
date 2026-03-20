---
name: package-code-review
description: Systematic per-package code review using six specialist perspectives (Correctness, Architecture, Type Safety, Security, Performance, Maintainability) with severity labels. Use when reviewing an entire package or a set of changed files for quality, compliance, and improvement opportunities.
---

# Package Code Review

## Rule Anchor
- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "No Fallback Policy"
- `AGENTS.md` > "Development Patterns"

## Use This Skill When
- Reviewing an entire package for quality and compliance.
- Reviewing a set of changed files before merge.
- Running periodic codebase health checks.

## Severity Labels

| Label | Meaning | Action Required |
|-------|---------|-----------------|
| **MUST** | Rule violation, bug, or security issue | Fix before merge |
| **SHOULD** | Architecture improvement, missing tests, spec drift | Fix in current or next iteration |
| **CONSIDER** | Refactoring opportunity, alternative approach | Author decides |
| **NIT** | Minor style or naming preference | Ignorable |

Classification rules:
- Any AGENTS.md Mandatory Rules violation → **MUST**
- SPEC.md quality gate gap → **SHOULD**
- Untested public API surface → **SHOULD**
- Everything else → **CONSIDER** or **NIT**

## Review Perspectives

Each package is reviewed through six specialist perspectives, in order:

### 1. Correctness
- Logic bugs and unreachable code paths
- Edge cases: null, undefined, empty arrays, boundary values
- Error handling completeness (catch boundaries narrowed, no silent swallowing)
- Invariant violations (terminal states re-entered, duplicate prevention anti-patterns)
- Promise handling (unhandled rejections, missing await)

### 2. Architecture
- Dependency direction (imports flow toward owner packages, no circular imports)
- Boundary violations (package imports from internals of another package)
- SSOT compliance (no re-declared types, no 1:1 trivial aliases)
- Module cohesion (single responsibility, no god files)
- Import standards (static by default, dynamic only for optional modules)
- No fallback patterns

### 3. Type Safety
- No `any`, `{}`, `as any`, `as unknown as T` in production code
- `unknown` narrowed before domain use
- Naming convention: `I*` for interfaces, `T*` for type aliases
- No trivial 1:1 type aliases
- Explicit return types on exported functions
- Type guards used at trust boundaries

### 4. Security
- No hardcoded secrets, API keys, or credentials
- Input validation at system boundaries (user input, external APIs)
- No command injection, XSS, SQL injection vectors
- No `eval()`, `new Function()`, or unsafe dynamic code execution
- Sensitive data not logged or exposed in error messages

### 5. Performance
- No unnecessary allocations in hot paths or loops
- No N+1 query patterns
- No synchronous blocking in async contexts
- Appropriate use of caching (check before compute, save after success)
- No unbounded growth (arrays, maps, event listeners without cleanup)

### 6. Maintainability
- Test coverage for public API surface
- Naming clarity (functions describe actions, variables describe content)
- File size: production files > 300 lines → **MUST** fix (split into focused modules)
- Function size: functions > 50 lines → **MUST** fix (extract sub-operations)
- Cyclomatic complexity: functions with > 15 branches → **SHOULD** simplify
- Documentation accuracy (SPEC.md reflects current implementation)
- Dead code (unused exports, unreachable branches)
- Magic numbers/strings without named constants → **SHOULD** fix
- Mutable function parameters → **MUST** fix (clone or create new objects)

## Execution Steps

1. **Scope**: Identify the target package(s) and file set.
2. **Context**: Read SPEC.md, package.json, and index.ts to understand the package boundary and public surface.
3. **Scan**: Read each production source file (exclude tests, examples, generated files).
4. **Review**: Apply all six perspectives to each file. Record findings with severity, perspective, file:line, and description.
5. **Cross-check**: Run harness commands to validate mechanical checks:
   ```bash
   pnpm --filter <pkg> build
   pnpm --filter <pkg> test
   pnpm harness:scan
   ```
6. **Report**: Output the review summary in the format below.

## Output Format

```
## [package-name] Code Review

### Summary
| Severity | Count |
|----------|-------|
| MUST     | N     |
| SHOULD   | N     |
| CONSIDER | N     |
| NIT      | N     |

### Findings

#### MUST
1. (Perspective) `file:line` — Description

#### SHOULD
1. (Perspective) `file:line` — Description

#### CONSIDER
1. (Perspective) `file:line` — Description

#### NIT
1. (Perspective) `file:line` — Description

### Positive Observations
- Things done well that should be preserved.
```

## DAG Package Review Checklist

When reviewing `dag-*` packages, additionally check:

1. Dependency direction: all imports flow toward `dag-core`; no cross-imports between sibling packages.
2. Node implementation: extends `AbstractNodeDefinition`, uses `NodeIoAccessor`, proper error codes.
3. Event naming: correct prefixes (`run.*`, `task.*`, `worker.*`, `scheduler.*`) and owned constants.
4. State machine integrity: terminal states remain terminal unless an explicit policy gate allows reprocessing.

## Stop Conditions
- Do not review test files, example files, or generated output (`.d.ts`, `dist/`).
- Do not flag patterns explicitly allowed by AGENTS.md (e.g., `unknown` at catch boundaries).
- Do not suggest changes beyond the review — create task files for large-scale work.

## Relationship to Other Skills
- Findings that require code changes → follow `repo-change-loop` skill.
- Findings about SPEC.md gaps → follow `spec-writing-standard` skill.
- Findings about type ownership → follow `type-boundary-and-ssot` skill.
- Findings about test gaps → reference `vitest-testing-strategy` skill.
