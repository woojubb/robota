---
"@robota-sdk/agent-cli": minor
"@robota-sdk/agent-app": patch
---

Watch a served session without being able to change it. `robota --serve --observer-port <port>` with `PRODUCT_OBSERVER_TOKEN` (at least 32 characters, different from the driver and HTTP tokens) opens a read-only loopback listener with its own token: an observer reads the conversation and state, cannot submit, answer prompts, run commands or switch sessions, and its disconnect does not end the session. A secure runtime and a hosted task worker refuse the flag.
