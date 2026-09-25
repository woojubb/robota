/**
 * Which calls an OS sandbox may approve without a prompt (issue #3082): only the shell tools, which
 * run their command through the sandbox. Another tool that takes a command line — a background
 * process, a model-invoked slash command — runs outside it, so the sandbox has nothing to say.
 */
import type { ICommandSandboxApproval } from '@robota-sdk/agent-session';
import type { ISandboxClient } from '@robota-sdk/agent-tools';

const SANDBOX_WRAPPED_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Shell']);

export function sandboxApprovalFor(client: ISandboxClient): ICommandSandboxApproval {
  return {
    autoApproves: (toolName, shellCommand) =>
      SANDBOX_WRAPPED_TOOLS.has(toolName) && client.autoApproves?.(shellCommand) === true,
  };
}
