/** How a session tool call is described to an editor. */

import type { ToolCallStatus, ToolKind } from '@agentclientprotocol/sdk';
import type { IToolState } from '@robota-sdk/agent-interface-session';

const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  Edit: 'edit',
  Write: 'edit',
  Shell: 'execute',
  Bash: 'execute',
  WebFetch: 'fetch',
  WebSearch: 'fetch',
};

const MAX_TITLE_DETAIL = 120;

export function acpToolKind(toolName: string): ToolKind {
  return TOOL_KINDS[toolName] ?? 'other';
}

/** The tool's name plus the one argument the session summarises it by, shortened for a title line. */
export function acpToolTitle(toolName: string, detail: string | undefined): string {
  const text = detail?.replace(/\s+/g, ' ').trim();
  if (!text) return toolName;
  const shown = text.length > MAX_TITLE_DETAIL ? `${text.slice(0, MAX_TITLE_DETAIL - 1)}…` : text;
  return `${toolName}: ${shown}`;
}

export function acpToolStartTitle(tool: IToolState): string {
  return acpToolTitle(tool.toolName, tool.displayPath ?? tool.firstArg);
}

/** A call that ended in error or was denied is `failed`; only a success is `completed`. */
export function acpToolEndStatus(tool: IToolState): ToolCallStatus {
  return tool.result === 'success' ? 'completed' : 'failed';
}
