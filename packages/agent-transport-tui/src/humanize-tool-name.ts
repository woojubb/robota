/**
 * SCREEN-012: turn a provider-safe projected tool id into the natural command name for display.
 *
 * Slash commands invoked by the model are projected to provider-safe tool ids prefixed with
 * `MODEL_COMMAND_TOOL_PREFIX` (`robota_command_`), optionally suffixed with a `_<8 hex>` hash when
 * the name would otherwise exceed the provider length limit (see model-command-tool-projection.ts).
 * For display we recover the command name: strip the prefix and a trailing projection hash. Tool
 * names that are not command projections (e.g. `Shell`, `Read`) are returned unchanged.
 */
import { MODEL_COMMAND_TOOL_PREFIX } from '@robota-sdk/agent-framework';

/** A trailing `_<8 lowercase hex>` projection hash appended to over-long command tool names. */
const PROJECTION_HASH_SUFFIX = /_[0-9a-f]{8}$/;

export function humanizeToolName(toolName: string): string {
  if (!toolName.startsWith(MODEL_COMMAND_TOOL_PREFIX)) return toolName;
  const body = toolName.slice(MODEL_COMMAND_TOOL_PREFIX.length);
  const withoutHash = body.replace(PROJECTION_HASH_SUFFIX, '');
  return withoutHash.length > 0 ? withoutHash : toolName;
}
