---
"@robota-sdk/agent-cli": patch
---

The telemetry setting errors (such as the one asking for `ROBOTA_TELEMETRY_LOGS=otlp`) and the invalid effort value error now name the environment variables the running product accepts instead of the canonical `PRODUCT_*` names, which an installed product ignores.
