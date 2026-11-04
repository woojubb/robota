import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"); what needs a Node host
 * is on `./node`. The platform gate bundles the main entry and fails on a Node reach; this pins
 * which side each export is on, so a move back is a visible test failure.
 */
describe('agent-mcp entry surfaces', () => {
  const nodeOnly = [
    'createStdioAdapter',
    'createNodeHttpEgress',
    'createNodeOAuthNetwork',
    'createFileOAuthCredentialStore',
    'createFileOAuthRefreshLock',
    'startOAuthCallbackServer',
    'freeLoopbackPort',
    'loopbackOAuthCallbackListener',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  it('keeps the ports, the neutral transport and the typed failures on the main entry', () => {
    for (const name of [
      'createStreamableHttpAdapter',
      'admitHttpEndpoint',
      'constructStreamableHttpTransport',
      'createWebFetchEgress',
      'MCPTransportEgressRefusedError',
      'MCPStdioError',
      'isExecutionEnvironmentName',
      'createOAuthFetch',
      'createPastedRedirectAcceptor',
      'oauthCredentialKey',
      'runMCPOAuthLogin',
      'runMCPOAuthLogout',
      'openMcpSession',
      'MCPConnectionSupervisor',
    ]) {
      expect(Object.keys(MainEntry)).toContain(name);
    }
  });

  it('exports nothing from ./node that the main entry also exports', () => {
    const main = new Set(Object.keys(MainEntry));
    expect(Object.keys(NodeEntry).filter((name) => main.has(name))).toEqual([]);
  });
});
