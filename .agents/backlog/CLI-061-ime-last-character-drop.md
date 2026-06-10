---
title: 'CLI-061: Korean IME last composed character dropped on Enter in TUI input'
status: todo
created: 2026-06-10
priority: medium
urgency: soon
area: packages/agent-transport
depends_on: []
---

# CLI-061: Korean IME last character drop on Enter

## Problem

When typing Korean via IME in the TUI input and pressing Enter, the last in-composition
character can be lost. Documented as a known limitation in
`packages/agent-transport/src/tui/InputArea.tsx:42-45`: Ink raw mode exposes no
compositionstart/compositionend events. For the product's primary Korean-speaking users this
corrupts almost every submitted prompt ending in Hangul — a core input feature that exists but
does not work correctly.

## Expected Behavior

Submitted prompt text includes the final composed character. Candidate mitigations to evaluate
(spec/design first): deferring submit by one input tick when the last byte sequence is an
incomplete/in-flight Hangul jamo composition; flushing pending composition bytes before
treating Enter as submit; or upstream Ink/stdin handling improvements.

## Test Plan

- Unit tests on the input flow reducer feeding byte sequences that simulate IME composition
  followed by Enter (the cjk-text-input-flow is a pure module and testable).
- Regression tests for non-IME input (no added latency or double-submit).
- `pnpm --filter @robota-sdk/agent-transport test`

## User Execution Test Scenarios

- Prerequisite: macOS/iTerm2 (and Terminal.app) with Korean IME; built CLI binary. Environment
  already exists.
- Steps: run `robota`, type `안녕하세요` and press Enter immediately while the last syllable is
  still composing.
- Expected observable result: the submitted user message in the transcript shows the full text
  `안녕하세요` including the final syllable.
- Cleanup: none.
- Evidence: (fill after implementation — TUI capture showing complete submitted text)
