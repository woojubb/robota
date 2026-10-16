---
'@robota-sdk/agent-tools': minor
---

`WebFetch` points to a site's llms.txt index. After returning an HTML page, it checks the page's origin once per tool instance for `/llms.txt`. The check runs through the same egress policy with a 2 s deadline and a 512 KB cap. When the site publishes a valid index (a 2xx plain-text or Markdown body whose first non-blank line is an H1), the result ends with one line naming the index URL; the index itself is not inlined. Origins without an index, soft 404s and failed or slow probes leave the result unchanged. Headers the caller supplied for the page are not sent with the probe. The tool description mentions `/llms.txt` and `/llms-full.txt`, and `createWebFetchTool({ llmsTxtProbe: false })` turns the check off.
