# agent-capability-pack Specification

## Purpose

Owns the **additive capability-bundle contract** for the Robota SDK: the `ICapabilityPack`
definition shape, the `IMergedCapabilities` result shape, and the pure `mergeCapabilityPacks`
merger. A capability pack is the _additive_ composition unit — a plain data record of named
capability buckets (command modules, tools, subagents) a consumer brings on top of a product's
base command modules. It is the additive analog of `@robota-sdk/agent-preset`: where a preset
dials **behavior** (subtractive tool/command selection, persona, permission posture), a pack
contributes **capability** (new tools, command modules, subagents). This package produces contract
types and one pure fold; it performs no session assembly and no IO.

## Boundaries

- Does **not** assemble sessions, construct providers, resolve presets, or build runtimes — those
  belong to `agent-framework` (assembly/runtime seam) and `@robota-sdk/agent-product` (the
  assembler that consumes this merger).
- Does **not** read settings, files, or env — it is a contract + pure function package.
- Does **not** execute contributed code. `mergeCapabilityPacks` folds pack contributions purely;
  any contributed command/tool runs only through the existing permission-gated runtime at call
  time, never by the mere act of being merged.
- Does **not** re-export `agent-framework` or `agent-core` (no pass-through re-export). It depends
  on them for contract types only.

## Model-facing / declarative-vs-executable note

A capability pack is **not declarative JSON**. Unlike a serialized manifest that a host can
enumerate without running contributor code, a pack carries **executable code objects** — command
modules with handlers, tool instances with `execute` functions, and subagent definitions. It is an
in-process composition argument handed to the assembler, not a serialized declaration, so
"no function across a serialization boundary" properties that would apply to a serialized manifest
do not apply here. The safety property instead rests on three invariants:

1. **Packs are opt-in** — a pack contributes only when a product profile lists it; a pack never
   self-activates.
2. **The merge is pure** — `mergeCapabilityPacks` executes none of the contributed code; it only
   folds declarations into a superset.
3. **Contributed code runs only through the permission-gated runtime** at call time.

## Merge semantics — conflict resolution

`mergeCapabilityPacks` is a pure, deterministic, IO-free fold — the additive analog of
`resolvePreset`.

- **Precedence:** base command modules claim the namespace first, then packs in profile order.
  First registration wins. A preset's enable/disable delta is applied _after_ this merge by the
  product shell — the merge widens, the preset delta filters; they compose rather than conflict.
- **Pack identity:** pack ids are claimed before any capability bucket is folded. A later
  duplicate pack id is rejected atomically — reported once, contributes nothing across every
  bucket, and does not stop a following unique pack.
- **Rejection channel:** a capability whose id is already claimed (by the base or by an earlier
  pack) is dropped from the merged result and reported in a separate rejection channel with its
  contributing pack id, kind, id, and reason — never as a thrown exception.
- **Purity:** the merger reads only its arguments and returns fresh arrays; it mutates neither the
  base command modules nor any pack.
- **Total field policy:** every public pack field is classified (consumed, surfaced,
  consumed-and-surfaced, or explicitly rejected) so that adding a new field to the pack shape fails
  compilation until the fold classifies it.

## Non-goals

- No workspace dependency beyond `agent-core` (tool contract) and `agent-framework` (command
  module / agent definition contracts), and neither is re-exported.
