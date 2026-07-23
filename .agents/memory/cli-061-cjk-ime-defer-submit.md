# CLI-061 — Korean-IME last-character drop (app-layer defer-submit)

## STATUS: DONE — merged PR #1269 (`b9893455f`), on develop (2026-07-23)

In-repo mirror (memory-mirroring rule). Host mirror: session memory `cli-061-cjk-ime-defer-submit.md`.

**Root cause (generalizable):** the final IME syllable reaches the pty as its OWN stdin event arriving JUST
AFTER the confirming `\r`; a synchronous submit fires first → drop (`안녕하세요` → `안녕하세`). A **terminal
raw-mode timing race, NOT an Ink bug** — every Node TUI reading raw stdin shares it (Node raw mode has no
compositionstart/end).

**Fix (app layer, no migration):** at the `CjkTextInput` submit effect, DEFER the submit
`IME_SUBMIT_DEFER_MS (50ms)` and re-read the LIVE `stateRef.current.value` at fire time (NEVER the Enter-captured
`effect.value`). Injectable-scheduler unit `flows/defer-submit.ts`. **Load-bearing:** the `isSubmitting` guard
blocks ONLY a second submit — the input pipeline stays LIVE during the window (else the trailing char is
re-dropped). Timer cancelled on unmount. Same fix Gemini CLI applied on the same Ink.

**Ink is the de-facto React-for-CLI standard; migration rejected** (the drop is terminal-layer, so switching
frameworks fixes nothing — full rewrite, zero benefit).

**Separate items:** CLI-062 cursor-position SIGSEGV (unblocked by Ink 7.1.1 `measureElement()` position coords +
screen-bounds clamp); in-line pre-edit display during composition is unsolved by any framework (terminal owns
the overlay). Testing: proven red-before-green (reviewer reproduced the failure on the pre-fix path).
