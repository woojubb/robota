export function parseParallelToolCalls(value: unknown, apiSurface: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error('parallelToolCalls must be a boolean');
  }
  if (apiSurface !== undefined && apiSurface !== 'chat-completions' && apiSurface !== 'responses') {
    throw new Error('parallelToolCalls requires a supported OpenAI API surface');
  }
  return value;
}

export function assertParallelToolCallsExecutor(
  policy: boolean | undefined,
  hasExecutor: boolean,
): void {
  if (policy !== undefined && hasExecutor) {
    throw new Error('parallelToolCalls cannot be used with an executor');
  }
}

export function parallelToolCallsWire(policy: boolean | undefined): {
  parallel_tool_calls?: boolean;
} {
  return policy === undefined ? {} : { parallel_tool_calls: policy };
}
