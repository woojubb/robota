/** What an editor learns about the session besides a turn: the commands it can offer, and the history of a loaded session. */

import { acpToolEndStatus, acpToolKind, acpToolStartTitle } from './acp-tool-mapping.js';

import type { IAcpUpdateStream } from './acp-updates.js';
import type { AvailableCommand } from '@agentclientprotocol/sdk';
import type { IHistoryDisplaySegment, ISessionCommands } from '@robota-sdk/agent-interface-session';

/**
 * The slash commands an editor may offer: the runtime's commands, then the user-invocable skills
 * whose names no command already uses. A command a client implements itself (its runner is the
 * client) is not offered, because an editor cannot run it and the runtime would not.
 */
export function availableCommands(
  session: Partial<Pick<ISessionCommands, 'listCommands' | 'listSkills'>>,
): AvailableCommand[] {
  const offered: AvailableCommand[] = [];
  const names = new Set<string>();
  const offer = (name: string, description: string, hint: string | undefined): void => {
    if (names.has(name)) return;
    names.add(name);
    offered.push({ name, description, ...(hint ? { input: { hint } } : {}) });
  };
  for (const command of session.listCommands?.() ?? []) {
    if (command.runner !== 'runtime') continue;
    offer(command.name, command.description, command.argumentHint);
  }
  for (const skill of session.listSkills?.() ?? []) {
    if (skill.userInvocable) offer(skill.name, skill.description, skill.argumentHint);
  }
  return offered;
}

/**
 * A loaded session's history as the editor would have seen it live: what the person typed, what the
 * agent answered, and each finished tool call with how it ended. A call keeps its own id unless that
 * id already named a row of this replay (a provider can reuse ids across turns), because the editor
 * would merge the two rows into one.
 */
export function replayHistory(
  segments: readonly IHistoryDisplaySegment[],
  updates: IAcpUpdateStream,
  nextToolCallId: () => string,
): void {
  const used = new Set<string>();
  for (const segment of segments) {
    if (segment.type === 'text') {
      if (segment.content === '') continue;
      updates.send({
        sessionUpdate: segment.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
        content: { type: 'text', text: segment.content },
      });
      continue;
    }
    const { tool } = segment;
    if (tool.internal) continue;
    let toolCallId = tool.executionId ?? nextToolCallId();
    while (used.has(toolCallId)) toolCallId = nextToolCallId();
    used.add(toolCallId);
    updates.send({
      sessionUpdate: 'tool_call',
      toolCallId,
      title: acpToolStartTitle(tool),
      kind: acpToolKind(tool.toolName),
      status: acpToolEndStatus(tool),
    });
  }
}
