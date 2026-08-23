# Enumerating a sink is not covering it

## STATUS: measured 2026-08-23 on SEC-019 across four review rounds

In-repo mirror (memory-mirroring rule). Host mirror: `enumerating-a-sink-is-not-covering-it`.

## The shape

Listing the sinks from the code is necessary and not sufficient. On SEC-019 the enumeration was
right — it named the tool label as one of seven sinks — and the fix went to the one of two render
branches being read at the time. Review found the other. Asking _who else obtains display text for a
tool_ then found three more, including a `firstArg` field carrying a path or shell command the model
chose, which no round had touched.

**A sink is a VALUE. A path is where that value is produced and where each consumer picks it up.**
Treating the value's name as the coverage list leaves every other consumer unguarded, and the next
consumer added is unguarded by default.

## How to apply

Put the treatment where the value is MADE, not at each use. When a function exists to turn raw input
into display or usable form, that function is the boundary — a new caller is covered because it
cannot obtain the value without passing through it. **If two constructors produce the value and share
nothing, that is itself the finding.**

Test the same way: assert the OUTPUT of a real render or call with poisoned input, never that a
sanitize call appears in the source. "The call is present" is satisfied by a file containing one call.

Related: [[wiring-tests-assert-the-wrong-half]], [[applied-check-must-read-the-code-line]]
