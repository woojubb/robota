---
'@robota-sdk/agent-product': patch
---

`catalogEntryOf` and `catalogEntriesFromRegistry` turn a list the owner keeps, or a page of the public MCP registry, into suggestions for the add form: an entry is kept only if the connector it stands for could be created, a registry remote is offered only when pasting one token can sign in to it, and the text of an entry is clipped to one plain line. The rules for a connector's input are now one function shared by the book and the catalog.
