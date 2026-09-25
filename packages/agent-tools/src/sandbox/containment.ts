/**
 * Where tool execution is contained, named rather than inferred from an absent value (issue #3081).
 *
 * Without a sandbox client every command runs on the host, and "no client" read as "nothing to say".
 * Naming it lets a host report the choice (`robota doctor`) and lets the tool factories route file
 * tools by one rule instead of each checking for a client.
 */

import type { ISandboxClient, TSandboxFilesystem } from './types.js';

export type TExecutionContainment = 'host' | `sandbox-${TSandboxFilesystem}`;

export function describeExecutionContainment(client: ISandboxClient | undefined): TExecutionContainment {
  if (client === undefined) return 'host';
  return `sandbox-${client.filesystem ?? 'separate'}`;
}

/** Whether file tools must read and write through the sandbox rather than the host filesystem. */
export function routesFilesThroughSandbox(client: ISandboxClient | undefined): boolean {
  return describeExecutionContainment(client) === 'sandbox-separate';
}
