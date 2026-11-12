---
"@robota-sdk/agent-cli": patch
---

`--help` and the errors for a missing or reused HTTP or observer token now name the environment variables the running product accepts (such as `ROBOTA_HTTP_TOKEN`) instead of the canonical `PRODUCT_*` names, which an installed product ignores.
