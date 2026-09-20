---
title: 'FLOW-2670: Register the robota URL scheme on each desktop platform'
issue: https://github.com/woojubb/robota/issues/2670
status: todo
created: 2026-09-20
priority: medium
urgency: next
area: packages/agent-cli, apps/agent-app
depends_on: [FLOW-2006]
---

# FLOW-2670: Register the robota URL scheme on each desktop platform

## Objective

Make a `robota://open` link clickable. FLOW-2006 delivers the versioned launch-intent contract, its
resolution and the `robota open <url>` caller; this record delivers the half that registers the
scheme with the operating system so a browser, a runbook or a chat client can hand the URL over, and
it extracts the grammar to a zero-dependency leaf package so the second consumer can reach it.

## Plan

- [ ] TC-01: Extract the launch-intent grammar from `packages/agent-cli/src/launch-intent/` into a zero-dependency leaf package, so `apps/agent-app` can consume it without depending on the CLI.
- [ ] TC-02: macOS — synthesize a user-level handler bundle (`CFBundleURLTypes` cannot be modified at runtime, and an npm-installed CLI has no bundle), and choose the terminal emulator to launch in.
- [ ] TC-03: Linux — write a user-level `.desktop` entry with `MimeType=x-scheme-handler/robota` and a bare, single `%u` field code.
- [ ] TC-04: Windows — write `HKCU\Software\Classes\robota` with the empty `URL Protocol` value and a quoted `%1` command, and refuse any extra argument the shell appends.
- [ ] TC-05: Electron — register `open-url` before `ready` and handle `second-instance` via `additionalData` rather than `argv`, whose order is documented as unstable.
- [ ] TC-06: Registration is user-scope only, is not silently automatic, and is suppressible by a setting with a managed/enterprise form.

## Test Plan

Unit tests for each platform's registration writer against a fake filesystem or registry, plus a
documented manual verification per platform — OS registration cannot be exercised in CI, which is
why FLOW-2006 kept it separate.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (>= 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: manual | 1`

On each supported desktop platform, register the handler, click a `robota://open` link from a
browser, and observe the session opening in the right directory with the prompt prefilled and unsent.

## Notes

Separated from FLOW-2006 on the evidence of the 2026-09-20 prior-art research: the registration
half rests on a different evidence base (Apple bundle rules, freedesktop field codes, the Windows
registry and `ShellExecute` argument splitting, Electron `open-url`/`second-instance`) and its
failure modes are environmental. Registered on the CLI/TUI umbrella
[issue #2670](https://github.com/woojubb/robota/issues/2670).
