---
name: package-code-review
description: Systematic per-package code review using six specialist perspectives (Correctness, Architecture, Type Safety, Security, Performance, Maintainability) with severity labels. Use when reviewing an entire package or a set of changed files for quality, compliance, and improvement opportunities.
---

# Package Code Review

This skill owns the review **taxonomy and method** (severity vocabulary, six perspectives, output
format). The underlying code rules are NOT restated here — they are owned by
[code-quality.md](../../rules/code-quality.md), [.agents/project-structure.md](../../project-structure.md)
(dependency direction), and the other rule documents; review against those rules directly.

## Rule Anchor

- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "No Fallback Policy"
- `AGENTS.md` > "Development Patterns"

## Severity Labels

| Label        | Meaning                                             | Action Required                  |
| ------------ | --------------------------------------------------- | -------------------------------- |
| **MUST**     | Rule violation, bug, or security issue              | Fix before merge                 |
| **SHOULD**   | Architecture improvement, missing tests, spec drift | Fix in current or next iteration |
| **CONSIDER** | Refactoring opportunity, alternative approach       | Author decides                   |
| **NIT**      | Minor style or naming preference                    | Ignorable                        |

Classification rules: any Mandatory Rules violation → **MUST**; SPEC.md quality gate gap or
untested public API surface → **SHOULD**; everything else → **CONSIDER** or **NIT**.

## Depth — the second axis, and a separate owner

Severity above says how much a finding matters. It does not say WHERE the defect is, and the two are
independent: a MUST can be local and a NIT can be the visible tip of a wrong design.

Every finding therefore also carries a depth verdict from `finding-depth-triager` (guardian), per
[finding-depth.md](../../rules/finding-depth.md) — LOCAL, FOUNDATIONAL, INVALID or UNDETERMINED. This applies
to a review invoked by hand exactly as it does to one the orchestration runs: a review that skips it produces
findings someone then fixes where they surfaced, which is the failure the rule exists to prevent, entering
through the door that is not watched.

A FOUNDATIONAL finding is reported with its cause and NOT fixed in place. What happens next — re-plan, or a
labelled containment naming a filed root item — is the caller's routing decision, not this skill's.

## Review Perspectives (apply all six, in order)

1. **Correctness** — logic bugs, edge cases, error-handling completeness, invariant violations,
   promise handling.
2. **Architecture** — dependency direction, boundary violations, SSOT compliance, cohesion,
   import standards, no fallback (rules: project-structure + code-quality).
3. **Type Safety** — the strict-TS rules in [code-quality.md](../../rules/code-quality.md)
   (no `any`, narrowing at trust boundaries, naming, explicit return types).
4. **Security** — no hardcoded secrets, boundary input validation, no injection vectors, no unsafe
   dynamic code execution, no sensitive data in logs/errors.
5. **Performance** — hot-path allocations, N+1 patterns, sync blocking in async contexts, caching,
   unbounded growth.
6. **Maintainability** — public-API test coverage, naming clarity, file/function size and
   complexity limits (per code-quality), SPEC accuracy, dead code, magic values.

**One more question, asked once per security- or correctness-relevant fix (under 1 and 4):**
_what else carries this value, and does the fix reach it?_ An issue names a site; the scope of the
issue is not the extent of the value, and a fix scoped to the named site reads as complete while
the other paths stay defective. Three instances in one day (issue #2314): the restored `orgPolicy`
loader reached four sites and not the fifth, a hand-maintained projection in `print-mode.ts`; a
decoder for two named `JSON.parse(...) as T` sites would have missed a third in a package the issue
never mentioned (`rtc-responder-gate.ts`); and SEC-009 hardened `providerProfile` to carry only an
env name while `parentConfig`, two lines above in the same literal, still carried the resolved
secret. Each answer was one search away. A fix that reaches one of several paths carrying the value
is a **SHOULD** until the other paths are named — fixed, or filed and linked.

## Execution Steps

1. **Scope** the target package(s)/file set; read SPEC.md, package.json, index.ts for the boundary.
2. **Review** each production source file through all six perspectives; record findings with
   severity, perspective, `file:line`, description.
3. **Cross-check** mechanically: `pnpm --filter <pkg> build && pnpm --filter <pkg> test` +
   `pnpm harness:scan`.
4. **Report** in the format below.

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
(repeat per severity)

### Positive Observations
- Things done well that should be preserved.
```

## Stop Conditions

- Do not review test files, example files, or generated output (`.d.ts`, `dist/`).
- Do not flag patterns the rules explicitly allow (e.g., `unknown` at catch boundaries).
- Do not make changes beyond the review — create task files for large-scale work.

## Relationship to Other Skills

Code changes → `repo-change-loop`; SPEC gaps → `spec-writing-standard`; type ownership →
`type-boundary-and-ssot`; test gaps → `vitest-testing-strategy`.
