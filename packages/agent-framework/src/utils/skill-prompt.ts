/**
 * Shell exec function for skill preprocessing — injected from composition root. `env` holds the
 * skill's variables (`CLAUDE_SKILL_DIR`, `CLAUDE_SESSION_ID`), added to the command's environment so
 * the shell expands them itself.
 */
export type TShellExecFn = (command: string, env?: Readonly<Record<string, string>>) => string;

/** Context variables available during skill prompt processing */
export interface ISkillPromptContext {
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
  context?: ISkillPromptContext,
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
 * If no exec function is provided, shell patterns are replaced with empty string.
 */
export async function preprocessShellCommands(
  content: string,
  exec?: TShellExecFn,
  env?: Readonly<Record<string, string>>,
): Promise<string> {
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
    if (exec) {
      try {
        output = exec(command, env);
      } catch {
        output = '';
      }
    }
    result = result.replace(full, output);
  }

  return result;
}
