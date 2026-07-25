# Neutrality & Prompt-Intervention Audit — 2026-07-24

Owner question: did the "Robota builds Robota" implementation (SELFHOST-001..014 wave + recent sessions)
break the layered monorepo's neutrality/universality principle ("packages/\* = neutral mechanisms, prompt
intervention avoided even in agent-cli")?

Method: 4 parallel read-only auditors — core tier / framework tier / surface tier / historical delta —
judging origin/develop `386af77e`, each with file:line evidence. Full per-file tables live in the four
audit transcripts; this document is the synthesized verdict + remediation index.

## Verdict

**The principle was NOT broken by the SELFHOST wave — the wave measurably IMPROVED the posture.**

- 12 of 13 package-touching capabilities landed as pure injected-policy mechanisms (plan-mode, guardrails,
  role routing, memory port, branching, tracing, orchestration...). Total wave prompt delta into
  `packages/*`: 2 tool descriptions (retrieval, computer-use), 1 threading glue line, 1 XML wrapper tag.
- The wave CREATED the repo's first five mechanical neutrality floors (agent-tools deps, orchestration,
  session-artifact, memory, evals — none existed before 2026-07-17).
- Opinions were correctly quarantined: `agent-provider-defaults` (role→model table) and `agent-preset`
  (personas) are chartered, opt-in, dependency-direction-clean opinion homes; the framework provably
  depends on neither.
- **agent-cli is still the thin neutral assembler** (its only prompt paths forward user-supplied flags);
  all six transports are content-neutral pipes; all providers are clean transmitters (zero editorializing).
- **Honest correction of the premise:** the pre-wave baseline was NOT prompt-free. The real debt entered
  2026-03..05 (imported Claude-Code-style tool descriptions, built-in agent prompts, compaction/naming
  prompts, memory heuristics) and simply never had a floor. The wave did not add to it; it also did not
  clean it up.

## Findings (consolidated, deduped; 4 audits: 2+6+8+8 raw → 6 remediation items)

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Tier         | Class                                   | Severity                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------- | -------------------------------------------------------------------- |
| 1   | `agent-framework/src/self-hosting/self-hosting-verification.ts` serializes THIS repo's process (`pnpm harness:verify`, `origin/develop`, pnpm-monorepo commands) into the published library (exported from index)                                                                                                                                                                                                                                                   | framework    | DOMAIN-LEAK                             | **high — worst single violation, and it IS a self-hosting artifact** |
| 2   | `agent-tools` builtin tool descriptions carry another product's policy verbatim, non-overridable: write-tool "NEVER create documentation files"; glob-tool references a nonexistent `Agent` tool; grep-tool says "NEVER ... as a Bash command" while the default tool name is `Shell`; shell-tool hardcodes sibling-tool routing regardless of what is registered                                                                                                   | core (tools) | HARDCODED-POLICY (pre-wave, 2026-03-19) | high                                                                 |
| 3   | `built-in-agents.ts` general-purpose prompt embeds house doctrine ("strict types, no fallbacks..."); built-in set is force-merged (shadowable by name, but not removable/replaceable); `subagent-prompts.ts` style mandates (≤500 words, no emojis) have no seam; agent-tool zod schema hardcodes the three built-in names                                                                                                                                          | framework    | HARDCODED-POLICY + one DOMAIN sentence  | high                                                                 |
| 4   | `.agents/tasks` task-context: house schema parsed + injected into EVERY session's system prompt with no toggle; `updateTaskFileStatus` writes into `.agents/` contradicting `paths.ts` "read-only" claim                                                                                                                                                                                                                                                            | framework    | HARDCODED-POLICY                        | medium                                                               |
| 5   | Core/session prompt hygiene: dead `builtin-templates.json` (7 personas, zero importers); `'You are a helpful AI assistant.'` default (seam exists but `\|\|` makes empty inexpressible; un-SPEC'd); `/compact` product vocabulary emitted by zero-dep core; compaction prompt dev-domain-biased + base irreplaceable + contradicts session SPEC; session-naming prompt seamless + sanitizer destroys non-Latin titles (Korean first message → garbage session name) | core/session | mixed (b)/(c)/(d)                       | medium                                                               |
| 6   | No mechanical floor for model-facing PROSE in packages: the 5 existing scans guard deps/identifiers/corpus files, not prompt text — plan-mode/guardrails/computer-use/built-ins/tool descriptions rest on convention only                                                                                                                                                                                                                                           | harness      | GAP                                     | high (the systemic fix)                                              |

Also noted (low, in transcripts): `SELF_VERIFICATION_CONTENT` boolean-only seam; `DEFAULT_AGENT_NAME='robota-cli'`
in preset resolution; `claudeMd` field name in a public contract; `.robota/skills` project-level discovery
asymmetry; dag-cli scaffold provider default; Brave endpoint in web-search errors; SPEC prompt-surface
declarations missing in agent-core/agent-tools.

## Remediation backlog

NEUT-001..006 in `.agents/backlog/` map 1:1 to the table above. Recommended order: 006 (floor first, so
cleanups ratchet), then 001/002/003, then 004/005.
