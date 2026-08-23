# The owner's user-facing language is Korean, pinned

**Owner of the rule:** [`../rules/naming-style.md`](../rules/naming-style.md) § Language Policy. This
file records the owner's standing instruction over it; the rule is still the instruction for everything
else.

The owner instructed (2026-08-23): "나에게 말할땐 한국어로 말해줘" — reply to them in Korean, not only
when their own message is Korean.

**Why this is recorded rather than assumed.** The Language Policy says user-facing replies match the
user's CURRENT message language, "matched per-message, never pinned to one language". A standing pin is
the one thing that line explicitly does not do, so an agent reading only the rule would revert to
English the first time the owner wrote in English. The precedence chain in
[`../../AGENTS.md`](../../AGENTS.md) settles it — user instructions outrank harness rules — but the
instruction has to be visible to the next session for that to help.

**Scope, unchanged from the rule.** Korean applies to what is addressed to the OWNER: reports,
questions, decision-requests. Everything else stays English — code and comments, repository documents,
commit messages, pull-request and issue bodies, and messages to peer agent sessions, which are not the
user.

**Not yet amended.** The rule text still reads "never pinned to one language". Whether that sentence
should gain a standing-preference clause is a rule amendment and has not been made; until it is, this
record plus the precedence chain is what carries the instruction.
