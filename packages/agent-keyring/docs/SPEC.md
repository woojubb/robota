# @robota-sdk/agent-keyring — Package Specification

## Purpose

Key custody and sealing primitives for conversations that must stay unreadable to other programs
running as the same operating-system user. The package owns one question: how a secret the user
remembers (a passphrase) or keeps (a recovery key) becomes the keys that protect stored artifacts,
and how artifacts are sealed to a public key so that writing never needs the secret.

It is pure computation over `node:crypto`: no file or network I/O, no native module, no
`@robota-sdk` dependency. It runs unchanged on Node.js and Bun and can sit beneath any package.
Where the keyring file lives, who may write it, how strong a passphrase must be, what an artifact
is, and when to lock stay with callers.

## Contract

- One random master key is the root of every key a keyring holds. It is never stored in the clear,
  never returned, and wiped from this package's own buffers as soon as the keypairs derived from it
  exist. A transient sealing keypair is the exception: random and derived from nothing a keyring
  holds, it opens what was sealed to it only while its holder keeps the private key.
- Keyslots are independent ways to recover the master key. Any one opens the keyring; changing one
  leaves the others and all data untouched.
- Writing needs only the sealing public key: a process that never unlocked can seal new artifacts,
  and only an unlocked keyring can open them.
- Each artifact has its own data key, sealed to the public key, and content is encrypted under it
  record by record. A wrong key, a wrong AAD, or a changed, truncated or extended byte fails the
  whole operation; plaintext is returned only after authentication.
- The attach keypair lets an unlocked keyring prove it is the owner to a verifier. Its public half
  is not in the keyring file, so write access to the file does not let anyone present as the owner.
- The sealing public key in the file is a convenience for locked writers, not a credential. Unlock
  does not depend on it, and a check after unlock reports whether the file still holds the key the
  master key derives.
- Failures are typed from a closed vocabulary and never carry a secret or a value derived from one.

## Invariants

- A wrong credential and a tampered slot are indistinguishable to the caller.
- Slot wrapping authenticates the format version, the slot id and the slot type, and nothing else.
  In particular it does not authenticate the sealing public key.
- A stored key-derivation cost is checked against fixed bounds before any derivation runs, so editing
  the file can neither downgrade the work factor nor make unlock allocate without limit.
- The keyring document has a fixed schema. Unknown fields (including any attach public key), unknown
  slot types and non-canonical encodings are refused rather than ignored; an unknown version is its
  own error. Parsing builds fresh values from validated primitives, so prototype-shaped input is
  never carried over.
- Derivation labels and wire formats are versioned. Known-answer vectors and a checked-in keyring
  fixture make any drift visible as a failing test.
- Every random value (IV, nonce, salt, ephemeral key) is fresh per operation and every new slot gets
  a fresh id; a passphrase change keeps the id of the slot it replaces. Only the keys derived from the
  master key are deterministic.

## Limits

- **Memory.** Wiping is best effort and covers only buffers this package allocates. A `KeyObject`
  offers no way to overwrite its contents and a passphrase string cannot be wiped, so `lock()` only
  stops handing out keys; it does not erase them.
- **Truncation.** A record carries no position, so a log cut at a record boundary is still a valid
  log. Detecting missing trailing records is the caller's job (a sequence number in the AAD plus a
  trusted record count or closing record); one record cannot know what follows it.
- **Swapped sealing public key.** The swap is detected after unlock, not prevented. Until then a
  locked writer that trusts the file seals to whatever key it holds; if an attacker planted that key,
  the artifacts are readable by the attacker and not by the owner. Already-sealed artifacts stay safe.
- **No proof of authorship.** The sealing key is public on purpose, so anyone who has it, including a
  program that never saw the passphrase, can produce an artifact that opens normally. Sealing keeps
  content secret; it does not show who wrote it. A caller that feeds stored history back into a model
  needs its own proof of authorship, and only an unlocked process can give one.
- **Wholesale replacement.** A program that can write the keyring file can replace it with a keyring
  of its own. The owner's passphrase then fails at the next unlock, which is the only detection there
  can be; nothing sealed to the replacement is readable by the owner.
- **No forward secrecy for sealed data keys.** The sender's ephemeral key protects only the sender
  side. Whoever later obtains the sealing private key (through the passphrase or the recovery key)
  can open every data key ever sealed to it.
- **Offline guessing.** The passphrase slot is only as strong as the passphrase plus the scrypt cost;
  a program that can read the keyring file can guess offline at that rate.
- **Nonce budget.** Records use random nonces, so one data key must seal far fewer records than the
  nonce space allows.

## Non-goals

- Master-key rotation. Replacing the master key means re-sealing every artifact, which belongs to
  whoever owns the artifacts.
- Passphrase policy, guess rate limiting and lockout.
- Hardware-backed unlock (device secrets, biometrics). The slot union can grow to hold one; none
  exists.
- Persistence, atomic writes and file permissions; when to lock, and process isolation.
- Defence against a program that can read the memory of an unlocked process or wait for the user to
  unlock.
- Algorithm agility. One suite per format version; a new suite is a new version.

## Design Decisions

- **`node:crypto` only, AES-GCM and scrypt.** ChaCha20-Poly1305 and Argon2 are missing on Bun or Node
  22, and a native module would break the cross-runtime guarantee and the install surface. These are
  the strongest primitives every supported runtime provides.
- **Cost parameters live in the slot and are bounded at unlock.** Storing them lets the default cost
  rise without breaking old keyrings; the bounds stop a hostile file from using that freedom.
- **The recovery key is derived with HKDF, not scrypt.** It is random and high-entropy, so stretching
  adds latency and no strength.
- **Two keypairs, two labels.** The sealing and attach keys come from separate versioned HKDF
  labels, so neither reveals nor weakens the other, and neither needs storing: both are re-derived
  at unlock.
- **The slot AAD omits the sealing public key.** A binding would turn a repairable tamper (a swapped
  public key) into a lockout of the owner's own data, and it would buy no confidentiality: whoever can
  write the file can replace the slots wholesale anyway.
- **The attach public key is kept out of the file.** If the file held it, the file's write access
  would be enough to enrol as the owner. The verifier obtains it by another route.
- **Sealing mixes both public keys into the key derivation.** The wrapping key is then bound to the
  exact sender and recipient pair, which also catches the bit of an X25519 key that the curve ignores.
- **Strict parsing over lenient parsing.** Ignoring an unknown field or slot would silently drop it
  on the next write. A new slot type therefore arrives as a parser change that older builds refuse.
- **Credentials are a tagged union.** Changing the passphrase accepts either the current passphrase or
  the recovery key, so a forgotten passphrase is recoverable without a second code path.
- **One AAD for a blob's key header and its record.** A blob is a single artifact; binding both parts
  to the same context keeps the single-step form as safe as the two-step form.
