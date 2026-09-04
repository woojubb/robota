# SPEC.md — {Package Name}

## Scope

{What this package owns — 2-4 sentences.}

## Boundaries

{What this package does NOT own and where those responsibilities live.}

## Architecture Overview

{Layer structure, key components, design patterns used — INSIDE this package.}

<!-- The package's position in the repository is not this document's to state. Its family, its layer,
     and which dependency edges are legal live in .agents/specs/ARCHITECTURE-MAP.md and in this
     package's package.json. Point at them; do not restate them. `spec-manifest-restatement` refuses
     a Layer field that enumerates dependencies (DOCS-028). -->

## Type Ownership

| Type       | Location        | Purpose   |
| ---------- | --------------- | --------- |
| {TypeName} | `src/{file}.ts` | {purpose} |

## Public API Surface

| Export       | Kind                | Description   |
| ------------ | ------------------- | ------------- |
| {ExportName} | class/function/type | {description} |

## Extension Points

{How consumers extend behavior — abstract classes, interfaces, strategies.}

## Error Taxonomy

| Error       | Code   | Category   | Recoverable |
| ----------- | ------ | ---------- | ----------- |
| {ErrorName} | {code} | {category} | yes/no      |

## Test Strategy

{Current test files, scenario verification, coverage gaps.}

## User Execution Test Scenarios

<!-- Required by .agents/rules/backlog-execution.md § User Execution Test Scenario Rule for work that
     changes runnable user-facing, command, TUI/browser or workflow behavior. Either write the
     scenario a user can personally run, or keep the exact not-applicable form below with a real
     product-surface reason (at least 50 characters; build/typecheck evidence does not count). -->

Not applicable.

**Reason:** {why no end user can observe this change directly through a runnable surface}

## User-Facing Contract

<!-- Optional. Only when an END USER (not calling code) directly observes and depends on this
     surface — key bindings, terminal visual grammar, exit codes. Placement criterion:
     .agents/skills/design-doc-authoring/SKILL.md > "Placement criterion". Delete if N/A. -->

## Class Contract Registry

| Class       | Implements/Extends | Defined In      |
| ----------- | ------------------ | --------------- |
| {ClassName} | {InterfaceName}    | `src/{file}.ts` |
