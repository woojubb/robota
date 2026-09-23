# Seedance Video Node Specification

## Purpose

The `seedance-video` DAG node generates a video from a text prompt via the ByteDance/ModelArk
(Seedance) video API, emitting a binary video output.

## Contract

- Video generation is asynchronous and this node owns the poll loop: it submits a job then polls
  until the job reaches a terminal status (`succeeded`/`failed`/`cancelled`) or a max-wait timeout
  elapses — unlike the image nodes, which make a single synchronous provider call.
- On timeout, the node makes a best-effort attempt to cancel the outstanding job before returning
  a task-execution error; cancellation failure does not change the reported outcome.
- Model resolution: an explicit `config.model` wins; otherwise the injected provider definition's
  default model is used, and its absence is a validation error. When an allowed-model list is
  injected and non-empty, the resolved model must be a member of it.
- `seed` is intentionally not exposed as a config option — the ModelArk Seedance provider rejects
  it.
- Cost estimate defaults to `config.baseCredits` (default 0.5) rather than a computed value.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`; does not redefine core DAG
  contracts.
- Delegates all provider/credential/model resolution to an injected `IMediaProviderDefinition`;
  concrete ByteDance SDK composition belongs to `@robota-sdk/agent-builtin-providers`, not here.
- This package is `private: true` — the DAG subsystem stays private. It is registered in the
  async/optional node-registry list: the ByteDance provider is optional, and the node self-skips
  if it cannot construct one.
- Does not read ambient environment variables itself — credential and endpoint environment names
  are declared by the injected provider definition.
