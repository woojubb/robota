/**
 * Framework system prompt suffixes for subagent sessions.
 *
 * These functions generate the standard prompt content injected into
 * subagent sessions to control output format and behavior.
 */

/** Options for assembling a subagent system prompt. */
export interface ISubagentPromptOptions {
  /** Agent definition markdown body. */
  agentBody: string;
  /** CLAUDE.md content to include. */
  claudeMd?: string;
  /** AGENTS.md content to include. */
  agentsMd?: string;
  /** When true, use fork worker suffix instead of standard subagent suffix. */
  isForkWorker: boolean;
}

/**
 * Returns the standard subagent suffix appended to agent body for normal subagents.
 */
export function getSubagentSuffix(): string {
  return `When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

In your final response, share file paths (always absolute, never relative) that are relevant to the task. Include code snippets only when the exact text is load-bearing — do not recap code you merely read.

Do not use emojis.`;
}

/**
 * Returns the fork worker suffix for context:fork skill workers.
 */
export function getForkWorkerSuffix(): string {
  return `You are a worker subagent executing a specific task. Do NOT spawn sub-agents; execute directly. Keep your report under 500 words. Use this structure:
- Scope: What was requested
- Result: What was done
- Key files: Relevant file paths (absolute)
- Files changed: List of modifications
- Issues: Any problems encountered`;
}

/**
 * Assembles the full system prompt for a subagent.
 *
 * Assembly order:
 * 1. Agent definition body
 * 2. CLAUDE.md content (if provided)
 * 3. AGENTS.md content (if provided)
 * 4. Framework suffix (fork worker OR standard subagent)
 */
export function assembleSubagentPrompt(options: ISubagentPromptOptions): string {
  const parts: string[] = [options.agentBody];

  if (options.claudeMd) {
    parts.push(options.claudeMd);
  }

  if (options.agentsMd) {
    parts.push(options.agentsMd);
  }

  const suffix = options.isForkWorker ? getForkWorkerSuffix() : getSubagentSuffix();
  parts.push(suffix);

  return parts.join('\n\n');
}
