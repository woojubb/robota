# Type Ownership and SSOT Specification

## Scope
- Defines owner-based SSOT strategy for shared contracts.
- Ensures each cross-package contract has one owner module and one public import surface.

## Core Rules
- Do not duplicate existing contract shapes under new names.
- Do not export meaningless aliases without semantic value.
- Consumers import from owner package public surfaces.

## Enforcement
- Contract drift is tracked by repository scans.
- New shared contract changes must preserve single ownership and explicit boundaries.
