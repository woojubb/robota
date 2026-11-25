# Local host authority

## Purpose

Gives Node composition roots the local authority they need to keep owner-protected state out of reach of the other programs of the same user, without importing a product entry point: the sealing keys and who may hold them open, how a supervised runtime is registered, reached and admitted, how approved workspace folders and project files are guarded, what a secure process may open, and the loopback server that shows a product's web GUI. A composition root composes these; none of them chooses a product path, and only the GUI server asks a person for anything: the access code the product printed.

## Contract

### Keyring store

- The keyring is read only from a regular file the user owns (where the host can verify it), never through a link, and input is bounded before parsing.
- A change replaces only the keyring it was built from, under one lock; an observed change is refused.
- A write is verified. One that cannot be confirmed is reported, and a reported failure may still have changed the file.

### Discovery of supervised runtimes

- A registration is untrusted metadata, read only from an owner-private directory and a regular file the user owns, never through a link.
- A runtime is controlled only once its recorded process start time proves it alive and its generation matches, a reply counts only when its owner echoes that generation, and a stop completes only once the registration is gone and the registered process has exited. A daemon is named only after an authenticated status exchange reports that it serves the workspace.
- A registration not known dead whose control cannot be proven refuses discovery instead of being skipped, and two daemons for one workspace refuse as ambiguous.
- Starts of a workspace's daemon take turns through one lock per workspace in the supervised directory. A live owner is waited for; a lock whose start is gone is never removed by a start, which refuses with the product's own removal hint, so removing it is the user's call.

### Admission and custody of a secure runtime

- Each command of the control socket has an explicit plain and secure admission. In secure mode a program of the same user keeps only what costs the owner at most a stopped runtime; the rest is reached inside an owner link, which the custody admits by what the link proved and nothing else.
- Before certification only the spawner is admitted: it may start and drive sessions and certify the runtime, and it holds no read keys. After it only the owner is admitted, and opens the runtime by handing it read keys over the link.
- Read keys go away on the owner's request, when the last attached client leaves, on a lock command and when the owner stops acting, and every link is told.
- A runtime nothing certified ends itself when no spawner links to it and when its spawner leaves without certifying it.
- An attached terminal or an owner link's session is one more surface under the session's own co-drive, prompt and session-switching rules and never an operator approver (an observer never submits or answers), so a connection that needs one is still refused. A reader that stops reading loses only its own connection.

### Start of a secure runtime

- A runtime takes its WebSocket token only from the pipe its launcher handed it and answers its spawner's pair before it starts any process. Both are checked exactly, nothing read is echoed, and a runtime told to expect either never falls back to another.
- The pair, the token and the secure mode of the state root must agree, or the start ends with a fixed message before anything listens: the pair belongs only to a supervised secure launch and excludes a token, and a secure runtime that is supervised or serves starts only with it.
- A secure runtime holds no passphrase and has no terminal; its key holder starts locked, and an owner link hands it read keys.

### Secure surfaces

- Every way a process runs and every listener it opens has one row: its plain admission, which secure mode never changes, and its secure one. A surface without a decision does not compile.
- In secure mode a listener that a program of the same user can satisfy (a token it can read, a login, "the same user") is refused with fixed copy before anything binds. The control socket opens for owner links, and the OAuth callback under its own rule, since it reaches no session.
- Plain mode opens exactly what it opened before. A refusal is a rejected promise, never a throw.
- Only a terminal the product owns may ask a person for the passphrase. Processes serving another program never unlock, and a supervised runtime unlocks only by an owner's read grant.

### Conversation mode choice

- The mode is one owner-only file under the state root saying whether the root's conversations are plain, being prepared for sealing, or sealed. Deciding to change it is the product's, under its own exclusive barrier; the package only reads it and commits the change.
- A missing choice is plain on a first run but ambiguous beside secure artifacts, and anything but a private, well-formed file is refused, never guessed at.
- A change commits only while the mode it expected is still on disk, checked again just before replacement, and is read back.

### Workspace-root broker, trust and fence

- The broker retains the exact folder object a person approved, and every project file operation compares its opened root with it.
- It lives only as long as the user-state root its approvals belong to and leaves nothing under its shared directory, so removing that root, like a broker or OS restart, requires one new approval per root.
- It also takes the checkpoint writer's exclusive lease, its atomic directory claims and the removals that let deleting a project session take everything the session left. A lease ends when its trust lease is revoked, the broker closes or the process that took it is gone.
- A start attaches to a live broker instead of launching a second, and only to an endpoint that answers.
- The trust service grants only a root a person approved through a prepared candidate. Every read, write, directory operation and writer lease of a trusted root crosses the broker, so the host never touches a project file directly, and a guarded checkpoint operation runs only while the broker still holds its lease.
- A native owner shell may ask the broker to approve a prepared candidate and to hold or release a Restricted choice; the person's answer is the shell's, since the broker cannot ask.
- Secure clients and runtimes fence the same physical Git root, or the exact folder outside one. A fence holds it through its own descriptor with the trust generation at admission, and refuses a folder replaced under the same name, a changed generation and a Restricted choice that no longer names the displayed folder.

## Invariants

- The GUI server treats every local program as hostile. The page that carries a runtime's credential, and a product API beside it, are served only to the browser that exchanged the access code for its path-scoped cookie, never to a request whose Host is neither loopback nor the one public host a TLS reverse proxy on the same machine publishes it under, and never from outside the web root. The server never listens beyond loopback, and over https its cookie is Secure.
- A state-changing API request also carries a header no cross-site form can set; a login can return to a named view only within its newly minted session; the host can keep the GUI unavailable until its runtime is ready; no request can crash the process serving it.
- A product may name one landing path for a browser another site sends back, such as an authorization server's redirect. It is served without the cookie, which a strict cookie would not send on such a redirect, but under the same Host rule, to a GET of exactly that path, with only the fixed page the product's handler returns, so what admits a request is what that handler checks, such as a one-time `state`.
- The key holder offers operations on the keys, never the keys themselves, so every way of locking ends in one place and a lock ends every way of reading, the data keys of writer epochs included.
- Sealing needs only the public key and works while locked; opening and authorship need the holder unlocked. No sealer error carries plaintext, a key or a path, and a swapped sealing key is never accepted quietly.
- The keyring store never logs or reports keyring content.
- A workspace daemon prover holds one authenticated handover at a time, and a failure to close a link permanently faults it.

## Non-goals

- The keyring store does not choose product paths, collect a passphrase, unlock a keyring, or decide which process receives owner authority. The composition root owns these decisions.
- Which surfaces a product runs and opens, whether secure mode is on and what an interrupted mode change blocks are the product's: the table says what each surface may be, not what the product starts.
- The broker cannot authenticate a person over its same-user IPC, so a direct local client can create a new approval; asking the person is the composition root's.
- `createWorkspaceDaemonProver` does not authenticate a control link itself: the opener its caller supplies (the owner link, for `proveWorkspaceDaemon`) must authenticate the selected binding before it returns a link.

## Design decisions

- From the first unlock in a process the key holder seals to the sealing key that unlock verified, locked or not, even when the repair of the file cannot be written. Before that first unlock a locked writer can only seal to the key the file holds; that is an accepted weakness, caught at the next unlock and visible meanwhile through the fingerprint. An append-only writer reuses one data key per store for a writer epoch because one public-key operation per line was measured too slow to read back; the epoch ends as soon as the verified key is not the one its data key was sealed to, and at every lock, because a writer's data key reads every line sealed under it and so is key material like any other.
- The keyring lock can be taken over after its stale bound even if its former holder is still alive. The final ownership and content checks are separate from the filesystem replacement, so a stalled or non-cooperating writer can change the file between them. The store does not provide an atomic compare-and-swap or an unconditional guarantee against restoring an older keyslot. On filesystems without hard links, creation also relies on a separate absence check and replacement.
- The broker holds the writer lease and the directory claims because it already holds the project root; a lease ends with the process that took it because a crashed client would otherwise leave a live-looking writer owned by the long-lived broker. A start claims the namespace directory before it launches anything because a sweep of the directories that gone brokers left could otherwise read a starting broker's directory as left over.
- A broker started by an older host refuses an operation added since as malformed, having done nothing, and the protocol version stays fixed because a bump would break the check that finds a live broker; telling the person to restart that broker is the composition root's. How a host runs its own binary as a broker is a function it supplies, not a command line the package builds, because the argument layout and the start bound belong to the binary that serves the broker; the package asks it only when no broker answers, so a live broker costs the host no launch work.
- A lock retires every link admitted before it so that an older link can neither install a delayed grant nor keep a decision open, and locking needs no proof because taking access away is something anyone who could stop the runtime can do. The idle lock counts only what a person does, because it exists for an owner who walked away: a viewer left open on a screen nobody watches, paging or refreshing, would otherwise keep the keys open for as long as it does.
- A spawner's authority ends with certification because a spawner only starts a runtime for its owner, and nothing it sent behind the certification may act with authority the runtime no longer grants it. The stop of an uncertified runtime exists because it was started for an owner and is useful to nobody until certified; it lets the work it runs end first, since stopping it mid-turn would cut that work short.
- A secure runtime has nothing to be admitted by but the owner link its spawner makes possible, which is why a plain runtime's token cannot stand in for the pair. The start takes plain values rather than a product's runtime because the option names are the product's launch layout, a prompt after `--` that spells a flag must stay text, and registering the holder as the product's sealing is the product's act.
- The listener gate takes the product's secure decision as an argument, evaluated where the listener starts, so the table does not know how the product decides secure mode. The cost is that a call site could write a decision in place, so each product names every place it opens a listener and checks that the decision is its own.
- Doubt about the conversation mode choice refuses rather than falling back, because plain beside sealed artifacts would write plaintext conversations next to sealed ones.
