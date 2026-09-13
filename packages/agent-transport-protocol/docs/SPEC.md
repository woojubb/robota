# @robota-sdk/agent-transport-protocol — Transitional Package Specification

## Transport Admission (SEC-008)

transport-admission: none — the S3 tombstone has no runtime behavior.

## 1. Scope

An empty, buildable, non-forwarding tombstone retained only between STRUCT-012 S3 and S5. All
transport-neutral protocol ownership has moved to `@robota-sdk/agent-transport`.

## 2. Boundaries

No public exports, runtime implementation, workspace dependency, compatibility re-export, or
consumer is permitted. Publication metadata remains only so S3 can finish green before S5 deletes
the package and records the release-time deprecation pointer.

## 3. Architecture Overview

`src/index.ts` contains only `export {}`. There are no subpath entries.

## 4. Type Ownership

None. Types formerly owned here are specified by `@robota-sdk/agent-transport`.

## 5. Public API Surface

None.

## 6. Extension Points

None.

## 7. Error Taxonomy

None.

## 8. Test Strategy

The package must build, typecheck, and collect zero tests. Repository scans verify that it forwards
nothing and has no live consumer; S5 removes the package entirely.

## 9. Class Contract Registry

None.
