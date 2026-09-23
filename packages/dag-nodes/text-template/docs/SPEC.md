# Text Template Node Specification

## Purpose

The `text-template` DAG node applies a template string to input text — deterministic templating
within DAG execution flows.

## Contract

- Two placeholder syntaxes are supported and both are replaced with the input text: `{{text}}`
  (Handlebars-style) and `%s` (printf-style). Use `%%s` to produce a literal `%s` in the output.
- Input text is validated before execution — a missing or non-string `text` input fails validation
  rather than reaching template substitution.
- Cost estimate is always zero.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`; does not redefine core DAG
  contracts.
- No external provider dependencies.
