/**
 * Agent hook executor — delegates to a subagent session.
 *
 * Creates a subagent session with maxTurns and timeout limits,
 * runs hook input as the initial prompt, and parses the result.
 *
 * Outcomes (SEC-015): `ok: true` → `allow`; `ok: false` → `deny` with its reason; a non-boolean or
 * missing `ok`, or an unparseable response → `error`/`malformed-response`; a session failure →
 * `error`/`transport-failure`. The last two used to share exit code 1.
 */

import { decodeHookVerdict } from '@robota-sdk/agent-core';

import type {
  IAgentHookDefinition,
  IHookInput,
  THookOutcome,
  IHookTypeExecutor,
  THookDefinition,
} from '@robota-sdk/agent-core';

/** Default maximum turns for the subagent session. */
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

  async execute(definition: THookDefinition, input: IHookInput): Promise<THookOutcome> {
    const agentDef = definition as IAgentHookDefinition;
    const maxTurns = agentDef.maxTurns ?? DEFAULT_MAX_TURNS;
    const timeout = agentDef.timeout ?? DEFAULT_TIMEOUT_SECONDS;

    try {
      const session = this.sessionFactory({ maxTurns, timeout });
      const prompt = `Hook input:\n${JSON.stringify(input)}\n\nRespond with JSON: { "ok": boolean, "reason"?: string }`;
      const rawResponse = await session.run(prompt);
      const jsonStr = extractJson(rawResponse);

      return decodeHookVerdict(jsonStr, 'agent');
    } catch (err: unknown) {
      return {
        outcome: 'error',
        source: 'agent',
        kind: 'transport-failure',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
