---
'@robota-sdk/agent-provider': patch
---

The DeepSeek model catalog now lists `json_object` instead of `json_schema` for every model, matching what DeepSeek's JSON Output supports and what the provider's capability table already declared. DeepSeek takes no schema parameter, so the catalog no longer advertises schema enforcement the endpoint does not offer.
