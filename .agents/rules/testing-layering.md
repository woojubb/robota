# Testing Layering (mandatory)

Feature behaviour is proven at the layer that OWNS it, never at the surface that exposes it, and
never skipped for want of an end-to-end path through that surface.

## Rules

1. **A surface owns no feature logic.** The layer a user touches parses input, wires transports and
   renders; every capability it appears to have is really the owning layer plus the feature.
2. **Surface tests cover only surface concerns** — argument parsing, option mapping, rendering,
   interaction. They must not be the place feature behaviour is proven.
3. **Feature behaviour MUST have a functional test at the owning layer**, driving the real session
   loop — real tools, real persistence, real events — through a deterministic scripted provider. No
   surface, no network and no live model is required to run it.
4. **"The surface cannot be end-to-end tested" and "it needs a live model" are rejected** as reasons
   to skip functional verification. A scripted harness makes the real loop deterministic and
   automatable; use it.
5. **A unit of work's Test Plan and its user-execution gate are satisfiable at the owning layer.** A
   product-surface scenario that genuinely depends on a live model is recorded as such, but the
   functional proof is the harness-based test, run by the agent and recorded as evidence.
6. **A new capability at the owning layer is registered in the capability manifest** and must carry a
   functional test; `functional-coverage` in `pnpm harness:scan` fails otherwise.

**Which package is which layer here** — the surface, the owning layer, the functional harness and the
scripted provider — is stated in [`.agents/project-structure.md`](../project-structure.md) §
Testing Layers, which owns the package listing and the dependency direction. This document owns the
rule; that one owns the map. The split is deliberate: the rule binds any repository, and the names
bind only this one.

## Why

Verifying at the surface, or claiming it cannot be verified, is how functional testing gets skipped.
The thing that must be tested is the session the feature actually runs in. A scripted harness exists
so a capability can be proven to work — deterministically, without a model — and so that proof is
mechanically required rather than optional.
