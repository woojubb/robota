# INFRA-035 — Interface-package purity guard (interface-accessors decision → A-keep + mechanize)

Spec: `.agents/spec-docs/active/INFRA-035-interface-package-purity-guard.md`

## Tasks

- [ ] T1 (TC-01/03): `scripts/harness/scan-interface-runtime.mjs` via **TS compiler API** (AST; strip comments/strings). For each `packages/agent-interface-*/src/**/*.ts` (excl tests): FAIL if (a) any value binding from a **bare (non-relative)** specifier — covers named, **default (`import Foo from 'x'`)**, and **namespace (`import * as z from 'x'`)** bindings that are not `import type`/all-`type`-qualified; or (b) a `class`/`abstract class`/`enum`/`const enum` declaration node. Relative value imports/re-exports + pure functions allowed.
- [ ] T2 (TC-02): register in `run-all-scans.mjs` (`name: interface-runtime`); reuse check-interface-imports.mjs package enumeration.
- [ ] T3 (TC-01): fixtures — FAIL: `import {z} from 'zod'`, value `@robota-sdk/*`, `class Foo{}`/`enum E{}`, `import Foo from 'x'`, `import * as z from 'x'`. PASS: multi-line `import type {…} from '@robota-sdk/agent-core'`, `class` in a comment, relative value re-export, the 4 accessors.
- [ ] T4 (TC-03): guard passes CURRENT agent-interface-transport + agent-interface-tui src unchanged.
- [ ] T5 (TC-04/05): `pnpm harness:scan` green (count+1); cross-ref guard from project-structure.md:22; close the interface-accessors design item in remediation log (A-keep + mechanized by INFRA-035).

## Test Plan / 검증

AST-based scan (TS compiler API) enforcing zero runtime dependency edges (no bare value imports) + no class/enum in interface-\* packages. Authoritative = fixture self-check (fails-on-violation incl. default/namespace/third-party; passes-on-current incl. multi-line-import & comment-class hazards) + harness:scan green. Non-breaking. Delegated to architecture-implementer.
