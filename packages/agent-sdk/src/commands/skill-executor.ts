/**
 * Skill execution logic.
 * Handles both fork-based (subagent) and inject-based (user message) execution.
 */

import { substituteVariables, type SkillPromptContext } from '../utils/skill-prompt.js';
import type { ICommand } from './types.js';

/** Options passed to the fork execution callback */
export interface IForkExecutionOptions {
  /** Agent identity to use (e.g., 'Explore', 'Plan') */
  agent?: string;
  /** Tools the subagent is allowed to use */
  allowedTools?: string[];
}

/** Callback interface for skill execution infrastructure */
export interface ISkillExecutionCallbacks {
  /**
   * Run skill content in an isolated subagent session.
   * The content becomes the subagent's prompt.
   * Returns the subagent's response.
   */
  runInFork?: (content: string, options: IForkExecutionOptions) => Promise<string>;
}

/** Result of skill execution */
export interface ISkillExecutionResult {
  /** Execution mode used */
  mode: 'fork' | 'inject';
  /** For inject mode: the prompt to send as a user message */
  prompt?: string;
  /** For fork mode: the subagent's response */
  result?: string;
}

/**
 * Build the processed skill content with variable substitution.
 * Returns the raw content after substitution (no XML wrapping).
 */
function buildProcessedContent(
  skill: ICommand,
  args: string,
  context?: SkillPromptContext,
): string | null {
  if (!skill.skillContent) return null;
  return substituteVariables(skill.skillContent, args, context);
}

/**
 * Build an inject-mode prompt from a skill command.
 * Wraps content in skill XML tags for the model.
 */
function buildInjectPrompt(skill: ICommand, args: string, context?: SkillPromptContext): string {
  const processed = buildProcessedContent(skill, args, context);
  if (processed) {
    const userInstruction = args || skill.description;
    return `<skill name="${skill.name}">\n${processed}\n</skill>\n\nExecute the "${skill.name}" skill: ${userInstruction}`;
  }
  return `Use the "${skill.name}" skill: ${args || skill.description}`;
}

/**
 * Execute a skill command.
 *
 * When `context: 'fork'`, the skill runs in an isolated subagent session
 * via the `runInFork` callback. Throws if `runInFork` is not available.
 * For non-fork skills, the content is returned as a prompt for injection
 * into the current session.
 */
export async function executeSkill(
  skill: ICommand,
  args: string,
  callbacks: ISkillExecutionCallbacks,
  context?: SkillPromptContext,
): Promise<ISkillExecutionResult> {
  // Fork execution: isolated subagent session
  if (skill.context === 'fork') {
    if (!callbacks.runInFork) {
      throw new Error('Fork execution is not available. Agent tool deps may not be initialized.');
    }

    const content = buildProcessedContent(skill, args, context);
    const prompt = content ?? `Use the "${skill.name}" skill: ${args || skill.description}`;

    const options: IForkExecutionOptions = {};
    if (skill.agent) options.agent = skill.agent;
    if (skill.allowedTools) options.allowedTools = skill.allowedTools;

    const result = await callbacks.runInFork(prompt, options);
    return { mode: 'fork', result };
  }

  // Inject execution: return prompt for current session
  const prompt = buildInjectPrompt(skill, args, context);
  return { mode: 'inject', prompt };
}
