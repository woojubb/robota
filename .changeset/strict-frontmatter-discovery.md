---
'@robota-sdk/agent-framework': major
---

Use the shared strict frontmatter decoder for skill, command, bundle plugin, and agent discovery. Reject malformed authority metadata with source diagnostics, preserve plugin invocation restrictions, and reject invalid agent limits before registration.

Remove the permissive public `parseFrontmatter` export as a breaking API change. Discovery sources now own validation; no compatibility parser is retained. The test-session harness accepts explicit project authority for trusted contribution fixtures.
