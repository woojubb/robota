import { randomUUID } from 'node:crypto';
import type { ISessionPermissions } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';

export interface ISessionCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedSessionCreateArgs {
  readonly maxCostUsd?: number;
  readonly allowedNodeTypes?: readonly string[];
  readonly deniedNodeTypes?: readonly string[];
  readonly noInstantNodes?: boolean;
  readonly error?: string;
}

function parseSessionCreateArgs(args: readonly string[]): IParsedSessionCreateArgs {
  let maxCostUsd: number | undefined;
  let allowedNodeTypes: string[] | undefined;
  let deniedNodeTypes: string[] | undefined;
  let noInstantNodes = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--max-cost') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { error: '--max-cost requires a value (e.g. 1.00)' };
      }
      const n = parseFloat(next);
      if (!isFinite(n) || n <= 0) {
        return { error: '--max-cost must be a positive number' };
      }
      maxCostUsd = n;
      i += 2;
    } else if (arg === '--allowed-nodes') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return {
          error:
            '--allowed-nodes requires a comma-separated list (e.g. input,llm-text-anthropic,text-output)',
        };
      }
      allowedNodeTypes = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i += 2;
    } else if (arg === '--denied-nodes') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { error: '--denied-nodes requires a comma-separated list' };
      }
      deniedNodeTypes = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i += 2;
    } else if (arg === '--no-instant-nodes') {
      noInstantNodes = true;
      i += 1;
    } else {
      return { error: `session create: unexpected argument: ${String(arg)}` };
    }
  }

  return { maxCostUsd, allowedNodeTypes, deniedNodeTypes, noInstantNodes };
}

const SESSION_HELP = `Usage: dag session <subcommand> [options]

Manage bounded agent sessions for the MCP server.

Subcommands:
  create    Generate a session config with limited permissions

Options (for create):
  --max-cost <usd>           Maximum total spend in USD (e.g. 1.00)
  --allowed-nodes <list>     Comma-separated whitelist of node types
  --denied-nodes <list>      Comma-separated blacklist of node types
  --no-instant-nodes         Disable instant node creation

Examples:
  dag session create --max-cost 1.00
  dag session create --allowed-nodes input,llm-text-anthropic,text-output
  dag session create --max-cost 0.50 --no-instant-nodes

The generated DAG_SESSION_PERMISSIONS value is read by the MCP server
at startup. Set it in the environment before running 'dag mcp'.
`;

function buildPermissions(parsed: IParsedSessionCreateArgs): ISessionPermissions {
  const perms: Record<string, unknown> = {};
  if (parsed.allowedNodeTypes !== undefined) perms.allowedNodeTypes = [...parsed.allowedNodeTypes];
  if (parsed.deniedNodeTypes !== undefined) perms.deniedNodeTypes = [...parsed.deniedNodeTypes];
  if (parsed.maxCostUsd !== undefined) perms.maxCostUsd = parsed.maxCostUsd;
  if (parsed.noInstantNodes === true) perms.canCreateInstantNodes = false;
  return perms as ISessionPermissions;
}

export async function sessionCommand(
  args: readonly string[],
  options: ISessionCommandOptions,
): Promise<number> {
  const { io } = options;
  const subcommand = args[0];

  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
    io.write(SESSION_HELP);
    return SUCCESS_EXIT_CODE;
  }

  if (subcommand !== 'create') {
    io.writeError(`Error: unknown session subcommand: ${subcommand}\n`);
    io.writeError(SESSION_HELP);
    return USAGE_ERROR_EXIT_CODE;
  }

  const parsed = parseSessionCreateArgs(args.slice(1));
  if (parsed.error !== undefined) {
    io.writeError(`Error: ${parsed.error}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const sessionId = `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const createdAt = new Date().toISOString();
  const permissions = buildPermissions(parsed);
  const envValue = JSON.stringify(permissions);

  io.write(`Session ID:  ${sessionId}\n`);
  io.write(`Created:     ${createdAt}\n`);
  io.write(`\nPermissions:\n`);

  if (parsed.allowedNodeTypes !== undefined) {
    io.write(`  allowedNodeTypes:      ${parsed.allowedNodeTypes.join(', ')}\n`);
  } else {
    io.write(`  allowedNodeTypes:      (all)\n`);
  }

  if (parsed.deniedNodeTypes !== undefined) {
    io.write(`  deniedNodeTypes:       ${parsed.deniedNodeTypes.join(', ')}\n`);
  }

  if (parsed.maxCostUsd !== undefined) {
    io.write(`  maxCostUsd:            $${parsed.maxCostUsd.toFixed(2)}\n`);
  } else {
    io.write(`  maxCostUsd:            (unlimited)\n`);
  }

  if (parsed.noInstantNodes === true) {
    io.write(`  canCreateInstantNodes: false\n`);
  }

  io.write(`\nTo activate, set before starting the MCP server:\n\n`);
  io.write(`  DAG_SESSION_PERMISSIONS='${envValue}' dag mcp\n\n`);

  return SUCCESS_EXIT_CODE;
}
