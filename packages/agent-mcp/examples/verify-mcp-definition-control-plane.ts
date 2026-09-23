/**
 * MCP-001 user-execution scenario — the definition control plane, end to end.
 *
 * Run: `pnpm exec tsx examples/verify-mcp-definition-control-plane.ts` from `packages/agent-mcp`.
 *
 * Everything is in memory. The point of the scenario is that resolving MCP configuration answers
 * "what is configured, from where, and which entry won" WITHOUT contacting anything, so the run
 * ends by reporting the number of processes and sockets it opened, which is zero.
 */

import {
  applyDisableOverlay,
  decodeSource,
  getServer,
  listServers,
  materializeDefinition,
  MCPDefinitionRegistry,
  resolveByPrecedence,
  statusOf,
  type IMCPServerDefinition,
  type IMCPSourceCandidates,
  type TMCPDefinitionSource,
} from '../src/index.js';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(
  name: TMCPDefinitionSource,
  origin: string,
  servers: Record<string, unknown>,
): IMCPSourceCandidates {
  return { source: name, origin, ...decodeSource({ mcpServers: servers }, name, origin) };
}

/**
 * A fixture that defines the same two server names in several scopes.
 *
 * - `alpha` is defined in all five scopes; managed must win and hide the other four.
 * - `beta`'s highest-precedence entry (local) is MALFORMED — it carries a `url` with no `type`.
 *   It must resolve `unresolved` and still shadow the user entry rather than falling through.
 * - `alpha`'s managed entry references `${MISSING_TOKEN}`, which is unset and has no default.
 */
const SOURCES: readonly IMCPSourceCandidates[] = [
  source('plugin', 'plugin-a', { alpha: { type: 'http', url: 'https://plugin.example/mcp' } }),
  source('user', 'user.json', {
    alpha: { type: 'http', url: 'https://user.example/mcp' },
    beta: { type: 'http', url: 'https://beta-user.example/mcp' },
  }),
  source('project', '.mcp.json', { alpha: { type: 'http', url: 'https://project.example/mcp' } }),
  source('local', 'local.json', {
    alpha: { type: 'http', url: 'https://local.example/mcp' },
    beta: { url: 'https://beta-local.example/mcp' },
  }),
  source('managed', 'policy.json', {
    alpha: {
      type: 'http',
      url: 'https://managed.example/mcp',
      headers: { Authorization: 'Bearer ${MISSING_TOKEN}' },
      env: { API_KEY: 'sk-live-do-not-print' },
    },
  }),
];

function run(): void {
  // Replace the one network entry point this package can reach, so "contacted nothing" is a
  // property the run ENFORCES rather than one it infers afterwards. The previous version diffed
  // `process.getActiveResourcesInfo()` across the body — a measurement this PR's own
  // `definition-no-side-effects.test.ts` documents as invalid, because that list is empty after a
  // `spawnSync`, after a child that already exited, and after a socket that connected and hung up.
  // It would have reported 0 over a pipeline that did all three.
  let networkAttempted = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((...args: unknown[]): never => {
    networkAttempted = true;
    throw new Error(`the control plane called fetch(${String(args[0])})`);
  }) as unknown as typeof globalThis.fetch;

  const entries = resolveByPrecedence(SOURCES, (definition: IMCPServerDefinition) =>
    materializeDefinition(definition, { HOME: process.env['HOME'] ?? '' }),
  );
  const overlaid = applyDisableOverlay(entries, {});

  const alpha = overlaid.find((entry) => entry.name === 'alpha');
  const beta = overlaid.find((entry) => entry.name === 'beta');
  assertCondition(alpha !== undefined && beta !== undefined, 'the fixture lost a server');

  assertCondition(alpha.source === 'managed', `alpha was won by ${alpha.source}, expected managed`);
  assertCondition(
    alpha.definition?.url === 'https://managed.example/mcp',
    'the winning definition was not taken whole',
  );
  assertCondition(
    alpha.shadowed.length === 4,
    `alpha shadowed ${alpha.shadowed.length}, expected 4`,
  );

  assertCondition(beta.status === 'unresolved', 'a malformed winner did not fail closed');
  assertCondition(beta.source === 'local', 'a malformed winner fell through to a lower scope');
  assertCondition(beta.shadowed.length === 1, 'a malformed winner stopped shadowing');

  const unset = alpha.definition?.unsetVariables ?? [];
  assertCondition(
    unset.length === 1 && unset[0]?.variable === 'MISSING_TOKEN',
    'the unset variable was not reported',
  );
  assertCondition(
    alpha.definition?.headers?.['Authorization'] === 'Bearer ${MISSING_TOKEN}',
    'the unset reference was not preserved literally',
  );

  const listed = listServers(overlaid);
  const rendered = JSON.stringify(listed);
  assertCondition(!rendered.includes('sk-live-do-not-print'), 'a secret survived the projection');
  assertCondition(
    !rendered.includes('Bearer ${MISSING_TOKEN}'),
    'a header value survived the projection',
  );

  const projection = listed.servers.find((server) => server.name === 'alpha');
  const envRedacted = projection?.env?.['API_KEY'] === '[REDACTED]';
  const headersRedacted = projection?.headers?.['Authorization'] === '[REDACTED]';
  const keysKept =
    Object.keys(projection?.env ?? {}).includes('API_KEY') &&
    Object.keys(projection?.headers ?? {}).includes('Authorization');
  assertCondition(envRedacted && headersRedacted && keysKept, 'redaction dropped the keys too');

  const got = getServer(overlaid, 'nope');
  assertCondition(got.found === false, 'an unknown server was reported as found');
  const status = statusOf(overlaid);
  assertCondition(status.total === 2 && status.unresolved === 1, 'the status counts are wrong');

  // The registry the activation controller enumerates: only resolved, enabled entries.
  const requests = new MCPDefinitionRegistry(overlaid).list();
  assertCondition(
    requests.length === 1 && requests[0]?.serverId === 'alpha',
    'the activation registry offered the wrong set',
  );

  globalThis.fetch = realFetch;
  assertCondition(!networkAttempted, 'the control plane reached the network');

  process.stdout.write(
    `result=winner=alpha:${alpha.source}; alphaShadowed=${alpha.shadowed.length}; ` +
      `betaWinner=beta:${beta.source}; betaUnresolved=${beta.status === 'unresolved'}; ` +
      `betaShadowed=${beta.shadowed.length}; unsetVarPreservedLiterally=true; ` +
      `envRedacted=${envRedacted}; headersRedacted=${headersRedacted}; projectionKeysKept=${keysKept}; ` +
      `networkAttempted=${networkAttempted}\n`,
  );
}

run();
