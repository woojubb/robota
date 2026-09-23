# Utility Text Node Specification

## Purpose

A collection of stateless text and data utility DAG node definitions (the `Utility` category) —
string and JSON transformation primitives for use in DAG pipelines.

## Contract

- All transformations are pure, synchronous logic with zero cost and zero credit estimate.
- No AI calls, no network calls, no dependencies beyond the DAG core/node packages.

## Non-goals

- Does not redefine core DAG contracts; each node extends the shared node definition base.
