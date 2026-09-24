# Utility Text Node Specification

## Purpose

A collection of stateless text and data utility DAG node definitions (the `Utility` category) —
string and JSON transformation primitives for use in DAG pipelines.

## Contract

- All transformations are pure, synchronous logic with zero cost and zero credit estimate.
- No AI calls, no network calls, no dependencies beyond the DAG core/node packages.

## Non-goals

- Does not redefine core DAG contracts; each node extends the shared node definition base.

## Bounded repetition

`text-repeat` calculates the UTF-8 size of its virtual output before allocating repeated text,
including separators and surrogate pairs formed across concatenation boundaries. An output
exactly at the trusted core ceiling is accepted; an over-limit output fails without expansion
with non-retryable `DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED`. Workflow config cannot raise the
ceiling. Repetition counts must be nonnegative safe integers. Zero repetitions yield an empty
string, one repetition ignores the separator, and empty output does not allocate an array or
iterate over the repetition count.

The guarantee bounds this operation's produced text, not already-created input, all intermediate
heap overhead, JSON snapshot encoding, other transforms, root aggregate consumption, or synchronous
CPU time. Byte accounting uses exact arithmetic so an overflow cannot turn rejection into admission.
