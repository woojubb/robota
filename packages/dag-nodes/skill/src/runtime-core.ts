import type { ICommand, ISkillExecutionPort } from '@robota-sdk/agent-interface-transport';
import {
  buildTaskExecutionError,
  buildValidationError,
  type IDagError,
  type TResult,
} from '@robota-sdk/dag-core';

/**
 * Configuration for the skill resolver runtime (ARCH-PROVIDER-005). The concrete skill discovery + resolution
 * is provided through the injected {@link ISkillExecutionPort}, so this leaf depends on the contract — NOT on
 * the `agent-framework` assembly. The composition root (`dag-nodes-default`) injects the agent-framework-backed
 * port; tests inject a stub.
 */
export interface ISkillResolverOptions {
  /** Skill discovery + resolution port (required — injected at the composition root). */
  skillPort: ISkillExecutionPort;
}

/** Request to resolve a skill to its inject-mode prompt. */
export interface ISkillResolveRequest {
  skillName: string;
  args: string;
  cwd: string;
  home?: string;
  sessionId?: string;
}

/** Result of resolving a skill. Derives from the port's `ISkillResolutionResult`, narrowed to a present prompt. */
export interface ISkillResolveResult {
  prompt: string;
  mode: string;
}

/**
 * Resolves a Robota skill (by name) to its inject-mode prompt string through the injected
 * {@link ISkillExecutionPort}. No LLM, no provider, no shell: the port resolves with empty callbacks so shell
 * interpolations are stripped rather than executed, and fork skills are rejected here before resolution.
 */
export class SkillResolverRuntime {
  private readonly port: ISkillExecutionPort;

  public constructor(options: ISkillResolverOptions) {
    this.port = options.skillPort;
  }

  public async resolvePrompt(
    request: ISkillResolveRequest,
  ): Promise<TResult<ISkillResolveResult, IDagError>> {
    let commands: ICommand[];
    try {
      commands = this.port.loadCommands(request.cwd, request.home);
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
      const result = await this.port.resolveSkill(
        skill,
        request.args,
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
