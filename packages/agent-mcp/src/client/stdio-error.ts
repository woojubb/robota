/**
 * A stdio transport's failure, named by a fixed reason only: never a command line, an argument,
 * an environment value or what the child wrote to stderr.
 *
 * It lives apart from the stdio transport because the session and the supervisor read it — to keep
 * a refusal typed and to classify a failure — and they run on every platform, while the transport
 * that throws it spawns a child process and needs a Node host (`@robota-sdk/agent-mcp/node`).
 */
export class MCPStdioError extends Error {
  constructor(
    readonly reason:
      | 'authority'
      | 'start'
      | 'early-exit'
      | 'send'
      | 'cancelled'
      | 'cleanup'
      | 'receive-limit'
      | 'receive-invalid',
  ) {
    super(`Stdio transport ${reason}`);
    this.name = 'MCPStdioError';
  }
}
