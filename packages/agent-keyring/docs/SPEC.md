# @robota-sdk/agent-keyring — Package Specification

## Purpose

Key custody and sealing primitives for conversations that must stay unreadable to other programs
running as the same operating-system user. The package owns two questions: how a secret the user
remembers (a passphrase) or keeps (a recovery key) becomes the keys that protect stored artifacts,
with artifacts sealed to a public key so that writing never needs the secret; and how a served
runtime comes to trust its owner and receive those keys, when every file, socket and token it can
see is within those programs' reach too.

It is pure computation over `node:crypto`: no file or network I/O, no native module, no
`@robota-sdk` dependency. It runs unchanged on Node.js and Bun. It is a Node host package, so only
Node-only code may depend on it.
Where the keyring file lives, who may write it, how strong a passphrase must be, what an artifact
is, when to lock, what each link standing may do and how link messages travel stay with callers.

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
- An unlock yields the read keys: the sealing keypair, and the authorship key, which has no public
  half and lets the owner tag what it wrote so a reader can tell the owner's artifacts from ones
  sealed by anyone else holding the public key. The attach keypair, which proves ownership to a
  verifier, is never part of that yield: it lives only in an owner handover, which hands out
  operations and never a key and is disposed once the command that opened it is done. None of these
  is in the keyring file, so write access to the file does not let anyone present as the owner.
- A served runtime trusts its owner only through a trust root its spawner installed: the owner's
  attach public key and a certificate binding the runtime's memory-only instance key to one runtime
  start. The spawner is admitted by a key it derived with the runtime over the channel the runtime
  inherited, and that key admits no one once the trust root is installed.
- On an owner link the runtime proves itself first, and the initiator checks that proof before it
  produces anything derived from its own secret. A program answering in a runtime's place, a runtime
  nobody certified and a runtime another keyring certified each receive only fresh randomness.
- Everything after the handshake is protected per direction under keys bound to the whole
  transcript, so the mode, the runtime start and both ephemerals cannot be changed or moved to
  another link; a frame that is altered, replayed, reordered or sent back fails and ends the link.
- A read grant carries the read keys and nothing more, only over an owner link and only from the
  handover that opened it. A runtime can then read and vouch, but never prove itself the owner,
  certify another runtime or change the passphrase.
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
- Derivation and link labels and every wire format are versioned. Known-answer vectors computed
  outside the package and a checked-in keyring fixture make any drift visible as a failing test.
- Every random value (IV, nonce, salt, ephemeral key, instance key) is fresh per operation and every
  new slot gets a fresh id; a passphrase change keeps the id of the slot it replaces. Only the keys
  derived from the master key are deterministic; link frame nonces count up under keys that exist
  for one link.
- Every link message has an exact length and one decoding, and a refusal carries a fixed reason and
  never key material.

## Limits

- **Memory.** Wiping is best effort and covers only buffers this package allocates. A `KeyObject`
  offers no way to overwrite its contents and a passphrase string cannot be wiped, so `lock()` and
  `dispose()` only stop handing out keys; they erase only the secrets held as plain bytes, such as
  the authorship key.
- **The spawner key before certification.** Until a runtime is certified, its spawner key admits
  whoever holds it. A program that can read the spawner's memory in that window can certify the
  runtime to its own keyring first; the owner then sees a certificate that is not theirs.
- **Truncation.** A record carries no position, so a log cut at a record boundary is still a valid
  log. Detecting missing trailing records is the caller's job (a sequence number in the AAD plus a
  trusted record count or closing record); one record cannot know what follows it.
- **Swapped sealing public key.** The swap is detected after unlock, not prevented. Until then a
  locked writer that trusts the file seals to whatever key it holds; if an attacker planted that key,
  the artifacts are readable by the attacker and not by the owner. Already-sealed artifacts stay safe.
- **Authorship needs the keys.** The sealing key is public on purpose, so anyone who has it, including
  a program that never saw the passphrase, can produce an artifact that opens normally: sealing keeps
  content secret and does not show who wrote it. An authorship tag does, but only an unlocked keyring
  can make or check one, so what a locked process writes carries none, and what an untagged artifact
  is worth is the caller's decision.
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
- Persistence, atomic writes and file permissions; when to lock, process isolation, what a link
  standing may do, and the stream that carries link messages.
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
- **One label per derived key.** The sealing keypair, the attach keypair and the authorship key come
  from separate versioned HKDF labels, so none reveals or weakens another, and none needs storing:
  all are re-derived at unlock.
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
- **Read keys and the owner handover are separate types.** Whatever holds keys for a while (a
  terminal session, an unlocked runtime) holds only what reading needs. The attach key, which can
  certify runtimes and prove ownership, is held for seconds, by the process the credential was typed
  into, and a type that holds read keys has no way to reach it.
- **The runtime answers first.** The initiator's proof depends on its secret, so it is made only once
  the runtime has proven itself; a socket another program took over never sees one.
- **The spawner key comes from an exchange, not a launch secret.** Deriving it over the inherited
  channel puts no secret on a descriptor, in the environment or in a file, and binding it to the
  instance key lets the spawner trust the key it then certifies. It has no lifetime of its own:
  certification, not a clock, ends spawner standing.
- **A certificate names the runtime start.** Binding the instance key to the runtime id and generation
  stops one certificate from vouching for another registration or a later start.
- **Frame nonces are counters that are never sent.** Each end expects the next one, so a replayed,
  reordered or dropped frame fails authentication with no separate check to get wrong.
- **A grant is bytes, never text.** It carries the sealing key's seed and the authorship key, which
  open straight into a key object and a buffer that are wiped; a string could not be.
