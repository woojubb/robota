# Utility Text Node Specification

## Purpose

A collection of stateless text and data utility DAG node definitions (the `Utility` category) —
string and JSON transformation primitives for use in DAG pipelines.

## Contract

- All transformations are pure logic with zero cost and zero credit estimate.
- No AI calls, no network calls, no dependencies beyond the DAG core/node packages.
- Supported output-expanding text operations preserve their literal transformation semantics while
  checking the virtual UTF-8 output before creating it. A host may tighten each operation's ceiling;
  workflow configuration cannot raise one. These bounds do not cover upstream input, snapshot
  encoding, other transforms, or CPU time. Regex replacement output remains outside the literal
  replacement ceiling.
- Text replacement delegates regex mode to a trusted operation capability supplied by the host,
  which may isolate or reject execution; a direct invocation without that capability runs inline
  with no CPU interruption guarantee. Configuration cannot opt out of host-supplied isolation or choose an executable worker entry.

## Non-goals

- Does not redefine core DAG contracts; each node extends the shared node definition base.
