/**
 * Definition of an agent that can be spawned as a subagent.
 *
 * Built-in agents and custom (user-defined) agents share this shape.
 * Optional fields inherit from the parent session when omitted.
 */
export interface IAgentDefinition {
  /** Unique name used to reference the agent (e.g., 'Explore', 'Plan'). */
  name: string;

  /** Human-readable description of the agent's purpose. */
  description: string;

  /** Markdown body content used as the agent's system prompt. */
  systemPrompt: string;

  /** Model override (e.g., 'claude-haiku-4-5', 'sonnet', 'opus'). Inherits parent model when omitted. */
  model?: string;

  /** Maximum number of agentic turns the subagent may execute. */
  maxTurns?: number;

  /** Allowlist of tool names. Only these tools are available when set. */
  tools?: string[];

  /** Denylist of tool names. These tools are removed from the inherited set. */
  disallowedTools?: string[];
}
