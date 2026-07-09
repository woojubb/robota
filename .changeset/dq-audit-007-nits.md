---
'@robota-sdk/agent-core': patch
---

DQ-AUDIT-007 — remove the silent `model || 'gpt-4o-mini'` default in the OpenAI streaming handler (a missing model now throws `ConfigurationError` instead of substituting a vendor default); document `IAIProvider`'s universal (`chat`) vs raw (`generateResponse`) dual surface as intentional in the agent-core SPEC.
