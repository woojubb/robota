# Text to Image Node Specification

## Purpose

DAG node that generates a **new** image from a text prompt only (no input image), via an injected
image-generation provider.

## Boundaries

- Pure generation only — prompt in, image out, no binary input port. Distinct from image
  edit/compose nodes, which take one or more input images; those are separate node packages.
- Delegates to an injected `IMediaProviderDefinition`/`IImageGenerationProvider` rather than
  embedding any specific provider SDK. Provider SDK composition belongs to the providers package,
  not this node package.
- Registered as an **async/optional** node, which the registry skips only when the package cannot be
  loaded or constructed. Without a usable provider (e.g. missing credentials) the node is still
  registered, and a run fails with a validation error naming what to configure, rather than failing
  DAG registration.

## Contract

- Model resolution: an explicit `config.model` wins; otherwise falls back to the injected
  provider definition's default model. No default model anywhere is a validation error.
- When an allowed-model list is injected, the resolved model must be a member of it.
- Unresolved provider credentials surface as a typed validation error, not a thrown exception.
