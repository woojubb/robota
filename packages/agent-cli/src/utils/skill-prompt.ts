/**
 * Build a skill prompt from slash command input.
 * Supports variable substitution and shell command preprocessing.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const skillCmd = registry
    .getCommands()
    .find((c) => c.name === cmd && (c.source === 'skill' || c.source === 'plugin'));
  if (!skillCmd) return null;
  const args = parts.slice(1).join(' ').trim();
  const userInstruction = args || skillCmd.description;

  // Run plugin hooks and capture stdout if this is a plugin skill/command
  let hookStdout = '';
  if (skillCmd.pluginDir) {
    hookStdout = runPluginHooks(skillCmd.pluginDir, input);
  }

  // Inject SKILL.md content if available
  if (skillCmd.skillContent) {
    // Preprocess shell commands first, then substitute variables
    let processed = await preprocessShellCommands(skillCmd.skillContent);
    processed = substituteVariables(processed, args, context);

    const parts: string[] = [];
    if (hookStdout) {
      parts.push(`<system-reminder>\n${hookStdout}\n</system-reminder>`);
    }
    parts.push(`<skill name="${cmd}">\n${processed}\n</skill>`);
    parts.push(`\nExecute the "${cmd}" skill: ${userInstruction}`);
    return parts.join('\n');
  }
  return `Use the "${cmd}" skill: ${userInstruction}`;
}

/**
 * Run a plugin's hooks and return collected stdout.
 * Reads hooks/hooks.json from the plugin directory and executes
 * all command hooks, passing the raw input as stdin JSON.
 */
function runPluginHooks(pluginDir: string, rawInput: string): string {
  const hooksPath = join(pluginDir, 'hooks', 'hooks.json');
  if (!existsSync(hooksPath)) return '';

  let hooksConfig: Record<string, unknown>;
  try {
    hooksConfig = JSON.parse(readFileSync(hooksPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return '';
  }

  const hooks = (hooksConfig.hooks ?? hooksConfig) as Record<string, unknown[]>;
  const stdoutParts: string[] = [];
  const stdinJson = JSON.stringify({
    session_id: '',
    cwd: process.cwd(),
    hook_event_name: 'UserPromptSubmit',
    prompt: rawInput,
  });

  // Execute all hook groups across all events
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const g = group as Record<string, unknown>;
      const hookDefs = g.hooks as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(hookDefs)) continue;

      for (const hook of hookDefs) {
        if (hook.type !== 'command' || typeof hook.command !== 'string') continue;

        // Resolve ${CLAUDE_PLUGIN_ROOT} in command
        const command = hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT}/g, pluginDir);

        try {
          const result = execSync(command, {
            input: stdinJson,
            timeout: 10000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd(),
            env: {
              ...process.env,
              CLAUDE_PLUGIN_ROOT: pluginDir,
              CLAUDE_PLUGIN_PATH: pluginDir,
              CLAUDE_PROJECT_DIR: process.cwd(),
            },
          });
          if (result.trim()) {
            stdoutParts.push(result.trim());
          }
        } catch {
          // Hook failed — skip
        }
      }
    }
  }

  return stdoutParts.join('\n');
}
