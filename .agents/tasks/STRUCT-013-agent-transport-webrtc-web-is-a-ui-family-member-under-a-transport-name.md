---
title: 'STRUCT-013: agent-transport-webrtc-web is a UI-family member under a transport name'
status: todo
created: 2026-09-05
priority: medium
urgency: later
area:
  - packages/agent-transport-webrtc-web
  - packages/agent-transport-gui
  - packages/agent-interface-tui
depends_on: [STRUCT-012]
no-issue: root item filed from the STRUCT-012 proposal review (2026-09-05) under the same owner direction that created STRUCT-012 locally — "파운데이셔널 이슈로 로컬에 새로 생성"; registration on GitHub is the owner's step
---

# STRUCT-013: agent-transport-webrtc-web is a UI-family member under a transport name

Root item recorded, not absorbed, by
`.agents/spec-docs/draft/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`
(§ Out of scope). No spec-doc yet — this is the problem statement, filed so the STRUCT-012 plan can
name it instead of carrying it.

## Problem

After STRUCT-012's unit S4 renames `agent-transport-gui` → `@robota-sdk/agent-ui-web` and
`agent-transport-tui` → `@robota-sdk/agent-ui-terminal`, exactly one family member is left whose name
and dependencies contradict each other. Measured on `develop` at `4b03d3248` (2026-09-05):

- `packages/agent-transport-webrtc-web/package.json`: `private: true`; `dependencies` =
  `agent-remote-pairing`, `agent-transport-gui`, `agent-transport-protocol`. **No edge to
  `agent-transport-webrtc`** — the Node WebRTC transport it is described as the browser mirror of
  (`.agents/project-structure.md:29`).
- `src/` is `client/`, `components/`, `hooks/`, `index.ts` — React components and hooks over the GUI
  core, the shape of a UI-family member, not of a transport that admits a peer (its own SPEC declares
  `transport-admission: none`, "the browser side PRESENTS a credential").
- So after S4 its manifest reads `agent-transport-webrtc-web → agent-ui-web + agent-remote-pairing +
agent-transport`: a transport by name whose runtime content is UI. The STRUCT-012 gate does not
  flag it (the edges are cross-family), which is precisely why it needs its own item — the name
  hierarchy is the detector, and this name lies to it.

Two related facts belong in the same scope, recorded here as candidates rather than decided:

1. **Neither `agent-transport-gui` nor `agent-transport-webrtc-web` declares a `browser` export
   condition or a `browser` field** (`node -e` over both manifests: `browserField=false`,
   `browserCondition=false`), although both are built for the browser (`vite`, `tsdown`
   `platform: 'browser'`). `CORE-028`'s scan (`scripts/harness/scan-browser-package-node-subpath.mjs`)
   keys on a declared `browser` condition, so it **cannot** refuse an
   `@robota-sdk/agent-transport/node` import from either package once STRUCT-012 ships that
   subpath. Declaring the condition is what arms the guard.
2. **`agent-interface-tui` is a contract package carrying the old family word** (`@robota-sdk/agent-interface-tui`
   `3.0.0-beta.79`, consumed by 2 workspace manifests). After `agent-ui-terminal` exists, the contract's
   name points at a family that no longer has a `tui` member; whether it becomes
   `agent-interface-ui-terminal` (or stays, as a contract name is not a family name) is a naming
   decision of the same kind.

## Why it is not being solved in STRUCT-012

STRUCT-012 is bounded to the edges its gate turns red plus the owner's rulings; this package has no
red edge after S4 and no owner ruling. Folding it in would widen a ~104-file unit with a decision the
owner has not made. STRUCT-012 § Out of scope names this file instead.

## USER-DECISION

- **The package's name and family.** Candidate: `@robota-sdk/agent-ui-webrtc` (a UI-family member
  that renders a WebRTC-paired session; reads as a sibling of `agent-ui-web`, which it depends on —
  which would be a **sibling edge** under the STRUCT-012 gate and would need the shared piece moved
  or the edge recorded as a layered exception, the `connect-fastify → connect-node` shape). Alternative:
  fold it into `agent-ui-web` as a `./webrtc` subpath (no new package, no sibling edge; the
  `agent-remote-pairing` dependency moves to `agent-ui-web`). The owner decides; both are costed in
  the spec-doc when this item is picked up. 34 live files reference the current name.
- **Whether the two related facts are in scope** (browser condition on the two UI packages;
  `agent-interface-tui`'s name) or become their own items.

## Plan

- [ ] Write the paired spec-doc under this ID with the two options costed, after STRUCT-012 S4 has
      landed (the measurement above changes once the rename exists).

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** A package rename or a manifest declaration changes nothing a person can see in the
browser monitor, the desktop application or the terminal; the paired session renders identically
before and after, and the only thing that changes for anyone is the package name in an import.
