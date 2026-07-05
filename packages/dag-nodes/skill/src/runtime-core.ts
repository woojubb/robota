import { SkillCommandSource, executeSkill } from '@robota-sdk/agent-framework';
import type { ICommand } from '@robota-sdk/agent-interface-transport';
import {
  buildTaskExecutionError,
  buildValidationError,
  type IDagError,
  type TResult,
} from '@robota-sdk/dag-core';

/** Loads the available skill commands for a working directory. */
export type TLoadSkillCommands = (cwd: string, home?: string) => ICommand[];

/** Configuration options for the skill resolver runtime (dependency injection for tests). */
export interface ISkillResolverOptions {
  /** Skill discovery. Defaults to `new SkillCommandSource(cwd, home).getCommands()`. */
  loadCommands?: TLoadSkillCommands;
  /** Skill resolution. Defaults to the real `executeSkill`. */
  executeSkillFn?: typeof executeSkill;
}

/** Request to resolve a skill to its inject-mode prompt. */
export interface ISkillResolveRequest {
  skillName: string;
  args: string;
  cwd: string;
  home?: string;
  sessionId?: string;
}

/** Result of resolving a skill. */
export interface ISkillResolveResult {
  prompt: string;
  mode: string;
}

function defaultLoadCommands(cwd: string, home?: string): ICommand[] {
  return new SkillCommandSource(cwd, home).getCommands();
}

/**
 * Resolves a Robota skill (by name) to its inject-mode prompt string. No LLM, no
 * provider, no shell: `executeSkill` is called with empty callbacks so shell
 * interpolations are stripped rather than executed, and fork skills are rejected.
 */
export class SkillResolverRuntime {
  private readonly loadCommands: TLoadSkillCommands;
  private readonly executeSkillFn: typeof executeSkill;

  public constructor(options?: ISkillResolverOptions) {
    this.loadCommands = options?.loadCommands ?? defaultLoadCommands;
    this.executeSkillFn = options?.executeSkillFn ?? executeSkill;
  }

  public async resolvePrompt(
    request: ISkillResolveRequest,
  ): Promise<TResult<ISkillResolveResult, IDagError>> {
    let commands: ICommand[];
    try {
      commands = this.loadCommands(request.cwd, request.home);
    } catch (err) {
      // allow-fallback: skill discovery failure surfaced as a retryable task error
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED',
          `Failed to load skills: ${message}`,
          true,
          { cwd: request.cwd },
        ),
      };
    }

    const skill = commands.find((command) => command.name === request.skillName);
    if (!skill) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_SKILL_NOT_FOUND',
          `Skill "${request.skillName}" was not found in ${request.cwd}`,
          { skillName: request.skillName },
          {
            action: 'set_config',
            suggestion: 'Set skillName to an available skill',
            options: commands.map((command) => command.name),
          },
        ),
      };
    }

    if (skill.context === 'fork') {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_SKILL_FORK_UNSUPPORTED',
          `Skill "${request.skillName}" uses fork context, which the resolver node does not support (no subagent runtime). Use an inject-context skill.`,
          { skillName: request.skillName },
        ),
      };
    }

    return this.resolveInject(skill, request);
  }

  private async resolveInject(
    skill: ICommand,
    request: ISkillResolveRequest,
  ): Promise<TResult<ISkillResolveResult, IDagError>> {
    try {
      const result = await this.executeSkillFn(
        skill,
        request.args,
        {},
        request.sessionId !== undefined ? { sessionId: request.sessionId } : undefined,
      );
      if (typeof result.prompt !== 'string') {
        return {
          ok: false,
          error: buildTaskExecutionError(
            'DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED',
            `Skill "${request.skillName}" did not resolve to an inject prompt`,
            false,
            { skillName: request.skillName, mode: result.mode },
          ),
        };
      }
      return { ok: true, value: { prompt: result.prompt, mode: result.mode } };
    } catch (err) {
      // allow-fallback: unexpected executeSkill failure surfaced as a task error
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED',
          `Failed to resolve skill "${request.skillName}": ${message}`,
          false,
          { skillName: request.skillName },
        ),
      };
    }
  }
}
