/**
 * Agent hook executor — delegates to a sub-agent session.
 *
 * Creates a subagent session with maxTurns and timeout limits,
 * runs hook input as the initial prompt, and parses the result.
 *
 * Exit codes:
 * - 0: ok: true (allow/proceed)
 * - 2: ok: false (block/deny), reason in stderr
 * - 1: execution error (session failure, parse error)
 */

import type {
  IAgentHookDefinition,
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
  IHookDefinition,
} from '@robota-sdk/agent-core';

/** Default maximum turns for the sub-agent session. */
const DEFAULT_MAX_TURNS = 50;

/** Default timeout in seconds. */
const DEFAULT_TIMEOUT_SECONDS = 60;

/** A minimal session interface for running a prompt. */
export interface IAgentSession {
  run(prompt: string): Promise<string>;
}

/** Factory that creates a session instance with the given options. */
export type TSessionFactory = (options: { maxTurns?: number; timeout?: number }) => IAgentSession;

/** Constructor options for AgentExecutor. */
export interface IAgentExecutorOptions {
  sessionFactory: TSessionFactory;
}

/** Extract JSON from a string, handling markdown code blocks. */
function extractJson(raw: string): string {
  const codeBlockMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(raw);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return raw.trim();
}

export class AgentExecutor implements IHookTypeExecutor {
  readonly type = 'agent' as const;

  private readonly sessionFactory: TSessionFactory;

  constructor(options: IAgentExecutorOptions) {
    this.sessionFactory = options.sessionFactory;
  }

  async execute(definition: IHookDefinition, input: IHookInput): Promise<IHookResult> {
    const agentDef = definition as IAgentHookDefinition;
    const maxTurns = agentDef.maxTurns ?? DEFAULT_MAX_TURNS;
    const timeout = agentDef.timeout ?? DEFAULT_TIMEOUT_SECONDS;

    try {
      const session = this.sessionFactory({ maxTurns, timeout });
      const prompt = `Hook input:\n${JSON.stringify(input)}\n\nRespond with JSON: { "ok": boolean, "reason"?: string }`;
      const rawResponse = await session.run(prompt);
      const jsonStr = extractJson(rawResponse);

      let parsed: { ok: boolean; reason?: string };
      try {
        parsed = JSON.parse(jsonStr) as { ok: boolean; reason?: string };
      } catch {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Failed to parse agent response as JSON: ${rawResponse}`,
        };
      }

      if (parsed.ok) {
        return { exitCode: 0, stdout: JSON.stringify(parsed), stderr: '' };
      }

      return {
        exitCode: 2,
        stdout: '',
        stderr: parsed.reason ?? 'Blocked by agent hook',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: '', stderr: message };
    }
  }
}
