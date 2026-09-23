# OK Emitter Node Specification

## Purpose

Owns the `ok-emitter` DAG node: a test/verification node that accepts a binary image input and emits
a string `"ok"` status output, used to verify upstream image pipeline correctness. Category: `Test`.

## Contract

- Input is re-validated on execution (not just at the validation stage) before `status` is set to
  `"ok"`, so a malformed binary payload fails execution even if it passed initial validation.
- No external provider dependencies, no constructor options, no environment variable dependencies.

## Non-goals

- Not a general-purpose image validator; it exists to prove an upstream pipeline produced _a_ valid
  image binary, nothing about the image's content.
