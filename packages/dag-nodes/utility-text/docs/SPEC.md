# Utility Text Node Specification

## Purpose

A collection of stateless text and data utility DAG node definitions (the `Utility` category) —
string and JSON transformation primitives for use in DAG pipelines.

## Contract

- All transformations are pure logic with zero cost and zero credit estimate.
- No AI calls, no network calls, no dependencies beyond the DAG core/node packages.
- `text-repeat` checks the UTF-8 size of its output before allocating repeated text and rejects an
  over-limit result without expansion, using exact byte arithmetic so an overflow cannot turn
  rejection into admission; this bounds only this operation's produced text, not input, snapshot
  encoding, other transforms, or CPU time, and workflow config cannot raise the ceiling.
- Text replacement delegates regex mode to a trusted operation capability supplied by the host,
  which may isolate or reject execution; a direct invocation without that capability runs inline
  with no CPU interruption guarantee. Configuration cannot opt out of host-supplied isolation or choose an executable worker entry.

## Non-goals

- Does not redefine core DAG contracts; each node extends the shared node definition base.
