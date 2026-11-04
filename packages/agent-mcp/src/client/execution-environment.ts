const EXECUTION_ENV =
  /^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_.*|DYLD_.*|PYTHONPATH|PYTHONHOME|RUBYOPT|PERL5OPT|BASH_ENV|ENV)$/i;

/**
 * Whether a variable changes what a runtime loads or executes, so no child program a host starts for
 * an MCP server — a stdio server or a headers helper — inherits it. A name test only: it reads no
 * environment, so it is the same on every platform.
 */
export function isExecutionEnvironmentName(name: string): boolean {
  return EXECUTION_ENV.test(name);
}
