---
'@robota-sdk/agent-keyring': minor
---

`@robota-sdk/agent-keyring` is published for the first time (issue #3679, secure conversation). It
keeps a master key wrapped by a passphrase and by a recovery key, derives the sealing and attach key
pairs and an authorship key from it (`tagAuthorship`/`verifyAuthorship` on the unlocked keys: an
HMAC-SHA256 tag only an unlocked keyring makes or checks), and seals artifacts to the sealing public
key, on `node:crypto` only;
`generateTransientSealingKeyPair()` makes a sealing key pair for a key that lives only in one
process's memory. It is in the
changeset fixed group, so it versions and publishes with the other `@robota-sdk/*` packages. Nothing
depends on it unless you add it; the CLI uses it for `secure` keyring custody.
