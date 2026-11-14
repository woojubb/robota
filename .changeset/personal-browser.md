---
'@robota-sdk/agent-product': minor
---

`@robota-sdk/agent-product/personal` adds the browser port and its tools. The agent reads a page as text with numbered elements and acts by number. When the agent's own action makes a request that writes to a site (any method but GET, HEAD and OPTIONS), the request is held and reported. Only `BrowserSubmit` sends it: the call names the request's method and address, and a person approves it every time. Reads, including data placed in a URL, are not held.
