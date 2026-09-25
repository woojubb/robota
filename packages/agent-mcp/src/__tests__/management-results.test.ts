/**
 * TC-11 — pure management results and the registry the activation controller enumerates.
 *
 * The registry half closes MCP-001's fourth Problem symptom: `MCPActivationController` was written
 * against a definition registry that had no producer, so `/mcp` could only ever see activation
 * decisions it was handed.
 */

import { describe, expect, it } from 'vitest';

import { applyDisableOverlay } from '../definition/overlay.js';
import { MCPDefinitionRegistry } from '../definition/registry.js';
import { getServer, listServers, statusOf } from '../management/results.js';
import { MCPActivationController } from '../mcp-activation-controller.js';
import {
  MCPActivationAdmissionService,
  InMemoryMCPActivationApprovalStore,
} from '../mcp-activation.js';

import type { IMCPResolvedEntry } from '../definition/types.js';

const resolved = (
  name: string,
  source: IMCPResolvedEntry['source'] = 'project',
): IMCPResolvedEntry => ({
  name,
  source,
  origin: `${source}.json`,
  status: 'resolved',
  definition: {
    name,
    source,
    origin: `${source}.json`,
    transport: 'http',
    url: `https://${name}.example/mcp`,
    headers: { Authorization: 'Bearer secret' },
    unsetVariables:
      name === 'gamma' ? [{ variable: 'MISSING', field: 'url', literal: '${MISSING}' }] : [],
  },
  shadowed: [{ name, source: 'user', origin: 'user.json' }],
});

const unresolved: IMCPResolvedEntry = {
  name: 'beta',
  source: 'managed',
  origin: 'policy.json',
  status: 'unresolved',
  problem: { name: 'beta', source: 'managed', origin: 'policy.json', reason: 'no `type`' },
  shadowed: [],
};

describe('listServers / getServer / statusOf', () => {
  const entries = [resolved('alpha'), unresolved, resolved('gamma')];

  it('lists every server as a redacted projection', () => {
    const { servers } = listServers(entries);
    expect(servers.map((server) => server.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(JSON.stringify(servers)).not.toContain('Bearer secret');
    expect(servers[0]!.shadowed).toEqual([{ source: 'user', origin: 'user.json' }]);
  });

  it('gets one server by name', () => {
    const result = getServer(entries, 'alpha');
    expect(result.found).toBe(true);
    expect(result.found && result.server.url).toBe('https://alpha.example/mcp');
  });

  it('returns a typed not-found rather than throwing, and says what does exist', () => {
    const result = getServer(entries, 'nope');
    expect(result.found).toBe(false);
    expect(result.found === false && result.name).toBe('nope');
    expect(result.found === false && result.knownNames).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('counts resolved, unresolved, disabled and unset-variable servers', () => {
    const withDisabled = applyDisableOverlay(entries, { disabled: { alpha: 'paused' } });
    const status = statusOf(withDisabled);

    expect(status).toMatchObject({
      total: 3,
      resolved: 2,
      unresolved: 1,
      disabled: 1,
      withUnsetVariables: ['gamma'],
    });
    expect(status.servers).toHaveLength(3);
  });

  // BEHAVIOR-2794 (issue #2794 / #3073): a source-level problem names no server, so it cannot live
  // inside `entries` — `listServers`/`statusOf` take it as a second, optional argument and carry it
  // through unfiltered rather than dropping it because there is nowhere in `IMCPResolvedEntry[]` to
  // put it.
  it('defaults to no source problems when none are given', () => {
    expect(listServers(entries).sourceProblems).toEqual([]);
    expect(statusOf(entries).sourceProblems).toEqual([]);
  });

  it('carries source-level problems through listServers and statusOf beside resolved servers', () => {
    const sourceProblems = [
      { name: '', source: 'managed' as const, origin: 'policy.json', reason: 'unreadable' },
    ];

    const { servers, sourceProblems: listed } = listServers(entries, sourceProblems);
    expect(servers).toHaveLength(3); // lower-trust sources still resolve
    expect(listed).toEqual(sourceProblems);

    const status = statusOf(entries, sourceProblems);
    expect(status.total).toBe(3);
    expect(status.sourceProblems).toEqual(sourceProblems);
  });
});

describe('MCPDefinitionRegistry', () => {
  it('offers exactly the resolved, enabled entries as activation requests', () => {
    const entries = applyDisableOverlay([resolved('alpha'), unresolved, resolved('gamma')], {
      disabled: { gamma: 'paused' },
    });
    const requests = new MCPDefinitionRegistry(entries).list();

    expect(requests.map((request) => request.serverId)).toEqual(['alpha']);
    expect(requests[0]!.endpoint).toBe('https://alpha.example/mcp');
    expect(requests[0]!.definitionFingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(requests[0]!.securityIdentity).toMatch(/^[0-9a-f]{32}$/);
    expect(requests[0]!.provenance).toEqual({
      kind: 'project',
      id: 'project.json',
      version: requests[0]!.definitionFingerprint,
    });
  });

  it('names a stdio definition by its command line, not by an invented url', () => {
    const stdio: IMCPResolvedEntry = {
      name: 'local-tool',
      source: 'local',
      origin: 'local.json',
      status: 'resolved',
      definition: {
        name: 'local-tool',
        source: 'local',
        origin: 'local.json',
        transport: 'stdio',
        command: 'python',
        args: ['server.py', '--port', '8080'],
        unsetVariables: [],
      },
      shadowed: [],
    };
    expect(new MCPDefinitionRegistry([stdio]).list()[0]!.endpoint).toBe(
      'python server.py --port 8080',
    );
  });

  it('is what MCPActivationController enumerates', () => {
    const entries = [resolved('alpha'), unresolved];
    const registry = new MCPDefinitionRegistry(entries, {
      workspace: { repositoryKey: 'repo-1', trustState: 'trusted', generation: 1 },
    });
    const controller = new MCPActivationController(
      registry,
      new MCPActivationAdmissionService(new InMemoryMCPActivationApprovalStore()),
      registry.displayNames(),
    );

    const summaries = controller.list();
    expect(summaries.map((summary) => summary.serverId)).toEqual(['alpha']);
    expect(summaries[0]!.source).toBe('project');
  });
});
