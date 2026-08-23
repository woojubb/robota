/**
 * SCREEN-012: turn a provider-safe projected tool id into the natural command name for display.
 *
 * Slash commands invoked by the model are projected to provider-safe tool ids prefixed with
 * `MODEL_COMMAND_TOOL_PREFIX` (`robota_command_`), optionally suffixed with a `_<8 hex>` hash when
 * the name would otherwise exceed the provider length limit (see model-command-tool-projection.ts).
 * For display we recover the command name: strip the prefix and a trailing projection hash. Tool
 * names that are not command projections (e.g. `Shell`, `Read`) are returned unchanged.
 *
 * ## SEC-019: this is where a tool label is made safe, not at each render site
 *
 * A tool name and its first argument come from the model, from an MCP server's manifest, or from a
 * plugin — all untrusted — and they are put on the terminal as text. Sanitizing at the render sites
 * was tried and failed within one review round: `MessageList` has two branches that show a tool name
 * and only one of them got the call, so a name carrying OSC 52 still reached `<Text>` whenever the
 * tool's content happened to parse as a structured summary. Three more sites had the same gap
 * (`StreamingIndicator`, and the label `tool-summary-status` composes for the history view).
 *
 * The defect is not that a call was forgotten. It is that "make this displayable" and "make this
 * safe to display" were two separate steps, so every new render site had to remember the second one.
 * They are one step here, and a fifth caller is covered because it cannot obtain the display text
 * without going through the function that sanitizes it.
 */
import { MODEL_COMMAND_TOOL_PREFIX } from '@robota-sdk/agent-framework';

import { sanitizeTerminalText } from './sanitize-terminal-text.js';

/** A trailing `_<8 lowercase hex>` projection hash appended to over-long command tool names. */
const PROJECTION_HASH_SUFFIX = /_[0-9a-f]{8}$/;

export function humanizeToolName(toolName: string): string {
  if (!toolName.startsWith(MODEL_COMMAND_TOOL_PREFIX)) return sanitizeTerminalText(toolName);
  const body = toolName.slice(MODEL_COMMAND_TOOL_PREFIX.length);
  const withoutHash = body.replace(PROJECTION_HASH_SUFFIX, '');
  return sanitizeTerminalText(withoutHash.length > 0 ? withoutHash : toolName);
}

/**
 * The first argument of a tool call, as display text.
 *
 * A separate function rather than a bare `sanitizeTerminalText` at the two sites that show it: the
 * argument is the other half of a tool label, it is equally untrusted — a path, a shell command, a
 * URL the model chose — and pairing it with {@link humanizeToolName} is what makes the boundary
 * findable. A render site that reaches for one naturally reaches for the other.
 */
export function humanizeToolArgument(firstArg: string | undefined): string {
  return firstArg === undefined ? '' : sanitizeTerminalText(firstArg);
}
