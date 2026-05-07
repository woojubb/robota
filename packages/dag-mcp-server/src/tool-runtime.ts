import type { IDagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';
import type { IDagMcpToolCallResult, IDagMcpUsageErrorPayload } from './types.js';

export type TDagMcpArgumentValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | TToolArgs
  | readonly TDagMcpArgumentValue[];

export interface TToolArgs {
  readonly [key: string]: TDagMcpArgumentValue;
}

export type TToolHandler = (
  args: TToolArgs,
  client: IDagOrchestrationHttpClient,
) => Promise<IDagMcpToolCallResult>;

export function toMcpResult(response: {
  readonly ok: boolean;
  readonly payload: object;
}): IDagMcpToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(response.payload, null, 2) }],
    isError: !response.ok,
  };
}

export function usageError(detail: string): IDagMcpToolCallResult {
  const payload: IDagMcpUsageErrorPayload = {
    ok: false,
    status: 2,
    errors: [
      {
        type: 'urn:robota:problems:dag:mcp_usage',
        title: 'Invalid MCP tool arguments',
        status: 2,
        detail,
        instance: 'mcp://dag',
        code: 'DAG_MCP_USAGE_ERROR',
        retryable: false,
      },
    ],
  };
  return {
    content: [{ type: 'text', text: `Error: ${detail}\n${JSON.stringify(payload, null, 2)}` }],
    isError: true,
  };
}

export function toToolArgs(args: object | null | undefined): TToolArgs {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as TToolArgs)
    : {};
}

export function requireString(
  args: TToolArgs,
  key: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly detail: string } {
  const value = args[key];
  if (typeof value === 'string' && value.trim().length > 0) return { ok: true, value };
  return { ok: false, detail: `${key} is required` };
}

export function optionalString(args: TToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function requireNumber(
  args: TToolArgs,
  key: string,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly detail: string } {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
  return { ok: false, detail: `${key} is required` };
}

export function optionalNumber(args: TToolArgs, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function requireObject(
  args: TToolArgs,
  key: string,
):
  | { readonly ok: true; readonly value: TToolArgs }
  | { readonly ok: false; readonly detail: string } {
  const value = args[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { ok: true, value: value as TToolArgs };
  }
  return { ok: false, detail: `${key} is required` };
}

export function optionalObject(args: TToolArgs, key: string): TToolArgs | undefined {
  const value = args[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TToolArgs)
    : undefined;
}
