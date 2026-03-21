---
title: Research Claude Code context calculation and compaction timing
status: backlog
priority: high
created: 2026-03-21
packages:
  - agent-core
  - agent-sessions
---

# Context Calculation and Compaction Timing Research

## Goal

Research how Claude Code calculates context usage and when/how it triggers compaction. Apply the same approach to Robota CLI.

## Current Problems

1. Token estimation (chars/3) is inaccurate — can underestimate or overestimate
2. Auto-compaction triggers after run() completes — too late if context fills during execution
3. Compaction during execution loop causes mid-stream interference
4. Pre-send check at 70% is a rough heuristic — may be too aggressive or too lenient

## Research Items

- [ ] How does Claude Code calculate token count? (API response metadata? tiktoken? chars-based?)
- [ ] When does Claude Code trigger compaction? (after each turn? before sending? threshold?)
- [ ] Does Claude Code compact mid-execution or only between user turns?
- [ ] What is Claude Code's compaction threshold? (percentage of context window)
- [ ] How does Claude Code handle the compaction summary? (system message? user message? separate context?)
- [ ] Does Claude Code truncate tool results to save context space?
- [ ] How does Claude Code handle the transition after compaction? (language preservation, context continuity)

## Expected Outcome

- Document findings in docs/superpowers/research/
- Update agent-core and agent-sessions to match Claude Code's approach
- Improve context stability for long conversations
