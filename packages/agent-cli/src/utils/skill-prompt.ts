/**
 * Build a skill prompt from slash command input.
 * Supports variable substitution and shell command preprocessing.
 */

import { execSync } from 'node:child_process';
import type { CommandRegistry } from '../commands/command-registry.js';

/** Context variables available during skill prompt processing */
export interface SkillPromptContext {
  /** Current session ID — substituted for ${CLAUDE_SESSION_ID} */
  sessionId?: string;
  /** Directory containing SKILL.md — substituted for ${CLAUDE_SKILL_DIR} */
  skillDir?: string;
}

/**
 * Substitute variables in skill content.
 *
 * Supported variables:
 * - `$ARGUMENTS` — all arguments passed to the skill
 * - `$ARGUMENTS[N]` — argument by index (0-based)
 * - `$N` — shorthand for `$ARGUMENTS[N]` (single digit, 0-9)
 * - `${CLAUDE_SESSION_ID}` — current session ID
 * - `${CLAUDE_SKILL_DIR}` — directory containing SKILL.md
 */
export function substituteVariables(
  content: string,
  args: string,
  context?: SkillPromptContext,
): string {
  const argParts = args ? args.split(/\s+/) : [];

  let result = content;

  // Replace $ARGUMENTS[N] before $ARGUMENTS to avoid partial match
  result = result.replace(/\$ARGUMENTS\[(\d+)]/g, (_match, index: string) => {
    return argParts[Number(index)] ?? '';
  });

  // Replace $ARGUMENTS with all args
  result = result.replace(/\$ARGUMENTS/g, args);

  // Replace $N shorthand (single digit, 0-9)
  result = result.replace(/\$(\d)(?!\d|\w|\[)/g, (_match, digit: string) => {
    return argParts[Number(digit)] ?? '';
  });

  // Replace ${CLAUDE_SESSION_ID}
  result = result.replace(/\$\{CLAUDE_SESSION_ID}/g, context?.sessionId ?? '');

  // Replace ${CLAUDE_SKILL_DIR}
  result = result.replace(/\$\{CLAUDE_SKILL_DIR}/g, context?.skillDir ?? '');

  return result;
}

/**
 * Preprocess shell commands in skill content.
 * Matches `` !`...` `` patterns and replaces them with command output.
 * Commands have a 5-second timeout.
 */
export async function preprocessShellCommands(content: string): Promise<string> {
  const shellPattern = /!`([^`]+)`/g;

  if (!shellPattern.test(content)) {
    return content;
  }

  // Reset lastIndex after test()
  shellPattern.lastIndex = 0;

  let result = content;
  let match: RegExpExecArray | null;

  // Collect all matches first to avoid mutation issues during replacement
  const matches: Array<{ full: string; command: string }> = [];
  while ((match = shellPattern.exec(content)) !== null) {
    matches.push({ full: match[0], command: match[1] });
  }

  for (const { full, command } of matches) {
    let output = '';
    try {
      output = execSync(command, {
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trimEnd();
    } catch {
      // On failure, substitute empty string
      output = '';
    }
    result = result.replace(full, output);
  }

  return result;
}

/** Build a skill prompt from a slash command input and registry */
export async function buildSkillPrompt(
  input: string,
  registry: CommandRegistry,
  context?: SkillPromptContext,
): Promise<string | null> {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? '';
  const skillCmd = registry.getCommands().find((c) => c.name === cmd && c.source === 'skill');
  if (!skillCmd) return null;
  const args = parts.slice(1).join(' ').trim();
  const userInstruction = args || skillCmd.description;

  // Inject SKILL.md content if available
  if (skillCmd.skillContent) {
    // Preprocess shell commands first, then substitute variables
    let processed = await preprocessShellCommands(skillCmd.skillContent);
    processed = substituteVariables(processed, args, context);
    return `<skill name="${cmd}">\n${processed}\n</skill>\n\nExecute the "${cmd}" skill: ${userInstruction}`;
  }
  return `Use the "${cmd}" skill: ${userInstruction}`;
}
