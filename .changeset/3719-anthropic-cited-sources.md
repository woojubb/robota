---
'@robota-sdk/agent-provider-anthropic': patch
---

Show the web sources an Anthropic reply cites: `chat()` now ends such a reply with a `[Sources]` list, one per address. Titles and addresses from web pages, in this list and in `[Web Search Results]`, can no longer carry control characters or markdown links, and only `http(s)` addresses are listed.
