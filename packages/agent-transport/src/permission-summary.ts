/**
 * The one argument a person recognises a tool call by, for every transport that puts a permission
 * request to a person in its own wire form. Shared so the transports name the same call the same
 * way; the built-in file tools take `filePath`, other tools `file_path` or `path`.
 */
import type { TToolArgs } from '@robota-sdk/agent-core';

/** In the order the tools put them first. */
const SUMMARY_ARGUMENTS = ['command', 'filePath', 'file_path', 'path', 'url', 'pattern', 'query'];

/** The call's identifying argument, or `undefined` when it has none worth showing. */
export function permissionSummaryArgument(toolArgs: TToolArgs): string | undefined {
  for (const key of SUMMARY_ARGUMENTS) {
    const value = toolArgs[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}
