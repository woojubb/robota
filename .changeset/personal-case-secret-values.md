---
'@robota-sdk/agent-product': patch
---

The case tools refuse a secret value in a case's text (a key, a token, a card or identity number, a word such as `password` followed by `:` or `=` and a value) and no longer refuse the words themselves, so a case can be about a password reset; the check is shared with the connector attention words.
