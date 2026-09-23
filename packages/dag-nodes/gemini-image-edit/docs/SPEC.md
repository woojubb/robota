# Gemini Image Edit Node Specification

## Purpose

DAG node definitions for AI-powered image editing (single image + prompt) and image composition
(multiple images + prompt) via Google Gemini models, including model resolution, input image
resolution (asset, data URI, HTTP), and output normalization.

## Contract

- Delegates all AI provider calls through an injected `IMediaProviderDefinition`; concrete Gemini SDK
  composition is owned elsewhere, not by this node package.
- Credential environment names are declared by the injected provider definition; the node does not
  read ambient environment variables itself.

## Design decisions

- **Node-only by declaration and by fact (CORE-028).** Since issue #2026, a model-provided HTTP
  image source is fetched through the shared Node egress boundary, so the package declares no
  `browser` export condition — consistent with the other Node-only nodes (`file-read`, `file-write`,
  `skill`) — rather than a nominal condition that happened to resolve to the Node bundle anyway.

## Non-goals

- Does not implement or compose the Gemini SDK itself.
- Does not redefine core DAG contracts.
