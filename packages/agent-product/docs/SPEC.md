# agent-product Specification

## Purpose

Owns the **product-assembly kernel**: the `IProductProfile` declarative product object, the
`IAssembledProduct` runtime-materials result, and the single composition function
`assembleProduct`. `assembleProduct(profile)` is a **pure, deterministic, IO-free fold** over
`IProductProfile` data with **zero product-specific branching** — the composition mechanism a
third party imports to build their own product on Robota's published runtime. `robota` is one
profile among many; an external repo brings its own.

## The pure-fold property

This package is carved out of the "no shared product factory" rule not on "profile-driven" alone —
a profile-driven function could still accrete per-product branches and become a de-facto shared
factory — but on a stronger property: `assembleProduct` reads only its argument, calls only pure
sub-folds and the framework's runtime-construction seam, and returns assembled materials. That
boundary has three parts:

1. **Dependency-graph neutrality** — declares no concrete transport/UI/CLI dependency.
2. **Purity / no I/O** — no filesystem, `process.env`, or settings read anywhere in this package;
   all resolved data is fed in from the shell that calls it.
3. **No product-name conditionals** — no branch on a profile's identity in any form (equality,
   switch, string-matching, or a lookup table keyed by identity). Reading the identity as data
   stays legal; branching on it does not.

## Contract

- Runtime construction is delegated entirely to `agent-framework`'s runtime-construction seam —
  this package does not re-implement it, so there is exactly one runtime-construction source of
  truth.
- Provider resolution order: an injected override wins, else a provider is constructed from
  `profile.providerSettings` via `agent-core`'s pure provider factory, else no provider is
  constructed and the caller must supply one when building the runtime. An unknown provider name
  throws, naming the supported types, rather than silently producing no provider.
- Preset resolution uses an instance-scoped registry built over built-ins plus the profile's
  presets — unless the profile supplies its own registry, which wins outright. This lets a shell
  that must resolve a preset before it can even construct the profile (because the preset carries
  values the profile is built from) reuse that same registry here rather than maintaining two
  equivalent-but-separate ones.
- Capability-pack merge precedence is base command modules < accepted packs in profile order;
  duplicate pack ids are rejected atomically before folding. Accepted packs, rejected
  capabilities, and rejected packs are all reported losslessly rather than only the accepted set.
- `providerErrorGuidance` is plain data the fold passes through unmodified when the shell hasn't
  supplied its own — it is never interpreted or branched on, and two assembled products in one
  process keep separate guidance.
- Every field of `IProductProfile` is exhaustively classified by a fold policy; adding a new
  profile field fails compilation until it is classified and behaviorally covered.

## Boundaries

- Does not import a concrete transport, TUI, remote-control, or CLI — those stay wired in the
  shell and are injected into the profile as data.
- Does not read settings, files, or env — the shell resolves those and passes in already-resolved
  data.
- Does not read provider settings, but does construct the provider from already-resolved config.
- Does not mutate any module-level preset registry global — it builds or adopts an
  instance-scoped registry only, so two calls never cross-contaminate.

## Error handling

`assembleProduct` throws no error classes of its own; preset resolution throws a plain `Error` on
an unknown preset id.
