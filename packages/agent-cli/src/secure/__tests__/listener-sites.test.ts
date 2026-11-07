/**
 * #3679 3f PR 3a — every listener product code opens is named here with its row of
 * `SECURE_SURFACES`, and opens through `startListener` at the product call site the row lists.
 *
 * A new place that opens a listener fails the first test until it is named, which means a decision
 * on its row; a row that is no longer opened anywhere fails the second. Library packages keep their
 * constructors: the product call site that starts them carries the row (the gate).
 */
import { describe, expect, it } from 'vitest';

import { LISTENER_SURFACES } from '../secure-surfaces.js';
import { gateCalls, isProductSource, listenerHits, scanProductSources } from './listener-scan.js';

import type { TListenerSurface } from '../secure-surfaces.js';

/** Every product file that can open a listener, and the rows its listeners belong to. */
const LISTENER_SITES: Readonly<Record<string, readonly TListenerSurface[]>> = {
  'packages/agent-cli/src/session-inventory/supervised-session-control.ts': ['control-socket'],
  'packages/agent-local-host/src/windows-control-pipe.ts': ['control-socket'],
  'packages/agent-cli/src/startup/workspace-root-broker.ts': ['control-socket'],
  'packages/agent-transport-ws/src/ws-transport-configurable.ts': ['websocket-transport'],
  'packages/agent-cli/src/modes/serve-http-host.ts': ['serve-http'],
  'packages/agent-cli/src/modes/serve-monitor-ui.ts': ['serve-monitor'],
  'packages/agent-transport-mcp/src/mcp-http-host.ts': ['mcp-http'],
  'packages/agent-cli/src/external-events/external-event-http-host.ts': ['external-events'],
  'packages/agent-cli/src/hosted/hosted-serve-ingress.ts': ['hosted-ingress'],
  'packages/agent-cli/src/hosted/desktop/gateway.ts': ['hosted-desktop-gateway'],
  'apps/agent-app/electron/remote-runtime.ts': ['desktop-remote-bridge'],
  'packages/agent-cli/src/remote-control/local-peer-channel.ts': ['local-peers'],
  // The WebRTC peer stack: remote control's transport and the device mesh's peers both run on it.
  'packages/agent-transport-webrtc/src/datachannel-loader.ts': ['remote-control', 'device-mesh'],
  'packages/agent-transport-webrtc/src/mesh-lan-listener.ts': ['device-mesh'],
  'packages/agent-transport-webrtc/src/turn-server.ts': ['device-mesh'],
  'packages/agent-transport-webrtc/src/mesh-mdns.ts': ['device-mesh'],
  'packages/agent-transport-webrtc/src/mainline-dht-store.ts': ['device-mesh'],
  'packages/agent-cli/src/startup/openrouter-oauth.ts': ['oauth-callback'],
  // The product's MCP sign-in opens the Node host's callback listener here, under its row.
  'packages/agent-cli/src/startup/mcp-oauth-host.ts': ['oauth-callback'],
  'packages/agent-mcp/src/node/oauth-callback.ts': ['oauth-callback'],
  // The sign-in calls the listener the host injected; the Node host's is `node/oauth-callback.ts`.
  'packages/agent-mcp/src/client/oauth/login.ts': ['oauth-callback'],
};

/** For each row, the product files whose `startListener(SECURE_SURFACES[row], …)` opens it. */
const LISTENER_GATES: { readonly [S in TListenerSurface]: readonly string[] } = {
  'control-socket': [
    'packages/agent-cli/src/modes/serve-mode.ts',
    'packages/agent-cli/src/cli-entry.ts',
  ],
  'websocket-transport': ['packages/agent-cli/src/product/runtime-plumbing.ts'],
  'serve-http': ['packages/agent-cli/src/modes/serve-mode.ts'],
  'serve-monitor': ['packages/agent-cli/src/modes/serve-mode.ts'],
  'mcp-http': ['packages/agent-cli/src/modes/mcp-serve-mode.ts'],
  'external-events': [
    'packages/agent-cli/src/cli-core.ts',
    'packages/agent-cli/src/modes/serve-mode.ts',
  ],
  'hosted-ingress': ['packages/agent-cli/src/hosted/hosted-runtime-startup.ts'],
  'hosted-desktop-gateway': [],
  'desktop-remote-bridge': [],
  'local-peers': ['packages/agent-cli/src/startup/host-action-adapters.ts'],
  'remote-control': [
    'packages/agent-cli/src/remote-control/remote-control-controller.ts',
    // The registry restarts the peer it holds on a session switch, outside the controller.
    'packages/agent-cli/src/remote-control/transport-host-adapter.ts',
  ],
  'device-mesh': [
    'packages/agent-cli/src/devices/device-enrollment.ts',
    'packages/agent-cli/src/devices/device-mesh-host.ts',
  ],
  'oauth-callback': [
    'packages/agent-cli/src/startup/mcp-oauth-host.ts',
    'packages/agent-cli/src/startup/openrouter-connection-host.ts',
  ],
};

/**
 * Rows no product call site opens, each with why. Their sites are named above, so a new one still
 * fails the scan; what is missing is a product call site to carry the row.
 */
const UNGATED: Partial<Record<TListenerSurface, string>> = {
  'hosted-desktop-gateway':
    'It opens no listener: it attaches to a server its deployer passes in, and no product process constructs it.',
  'desktop-remote-bridge':
    'The desktop app has no secure-mode input and cannot import this table until the desktop owner surface (3f PR 7) gives it one.',
};

const scan = scanProductSources();

function describeHits(path: string): string {
  return `${path}: ${(scan.hits.get(path) ?? []).map((hit) => `${hit.line} ${hit.match}`).join(', ')}`;
}

describe('listener sites', () => {
  it('names every place in product code that can open a listener', () => {
    const unnamed = [...scan.hits.keys()].filter((path) => !(path in LISTENER_SITES)).sort();
    expect(unnamed.map(describeHits)).toEqual([]);
  });

  it('names no file that opens no listener any more', () => {
    expect(Object.keys(LISTENER_SITES).filter((path) => !scan.hits.has(path))).toEqual([]);
  });

  it('gives every listener row at least one site', () => {
    const named = new Set(Object.values(LISTENER_SITES).flat());
    expect(LISTENER_SURFACES.filter((surface) => !named.has(surface))).toEqual([]);
  });
});

describe('listener gates', () => {
  it('names its row literally in every startListener call', () => {
    const unnamed = [...scan.gates].flatMap(([path, calls]) =>
      calls.filter((call) => call.surface === undefined).map((call) => `${path}:${call.line}`),
    );
    expect(unnamed).toEqual([]);
  });

  it('opens every listener row through a product call site, except the rows named as ungated', () => {
    const ungated = LISTENER_SURFACES.filter((surface) => LISTENER_GATES[surface].length === 0);
    expect(ungated).toEqual(Object.keys(UNGATED));
  });

  it('opens each row through exactly the gates listed for it', () => {
    const opened = Object.fromEntries(
      LISTENER_SURFACES.map((surface) => [surface, new Set<string>()]),
    );
    for (const [path, calls] of scan.gates) {
      for (const call of calls) if (call.surface !== undefined) opened[call.surface]?.add(path);
    }
    const actual = Object.fromEntries(
      Object.entries(opened).map(([surface, paths]) => [surface, [...paths].sort()]),
    );
    const listed = Object.fromEntries(
      Object.entries(LISTENER_GATES).map(([surface, paths]) => [surface, [...paths].sort()]),
    );
    expect(actual).toEqual(listed);
  });
});

describe('the listener scan itself', () => {
  const opening = [
    ['server.listen(0, "127.0.0.1")', 'listen('],
    ['listen(server, port, host)', 'listen('],
    ['const server = createServer(handler)', 'createServer('],
    ['http2.createSecureServer({})', 'createSecureServer('],
    ['new WebSocketServer({ noServer: true })', 'new WebSocketServer('],
    ['new WebSocket.Server({ port: 0 })', 'new WebSocket.Server('],
    ['Bun.serve({ fetch })', 'Bun.serve('],
    ['Bun.udpSocket({})', 'Bun.udpSocket('],
    ["const dht = 'bittorrent-dht'", "'bittorrent-dht'"],
    ["requireFrom('multicast-dns')", "'multicast-dns'"],
    ['resolve(`node-datachannel`)', "'node-datachannel'"],
    ["kernel.func('__stdcall', 'CreateNamedPipeW', 'void*', [])", "'CreateNamedPipeW'"],
  ] as const;

  it.each(opening)('finds %s', (code, match) => {
    expect(listenerHits('packages/x/src/a.ts', code).map((hit) => hit.match)).toContain(match);
  });

  it('counts .bind( only where dgram is loaded, since elsewhere it binds a function', () => {
    const socket =
      "import { createSocket } from 'node:dgram';\nconst s = createSocket('udp4');\ns.bind(0);";
    expect(
      listenerHits('packages/x/src/a.ts', socket).map((hit) => `${hit.line} ${hit.match}`),
    ).toEqual(["1 'node:dgram'", '2 createSocket(', '3 .bind(']);
    expect(listenerHits('packages/x/src/a.ts', 'const f = handler.bind(this);')).toEqual([]);
  });

  it('ignores comments, prose in strings and names that only contain a listener word', () => {
    const quiet = [
      '// server.listen(0)',
      '/* createServer() and new WebSocketServer() */',
      'const hint = `the optional dependency "node-datachannel" is missing`;',
      "const word = 'listen';",
      "window.addEventListener('message', onMessage);",
      'await listenForPeerMessages(options);',
    ].join('\n');
    expect(listenerHits('packages/x/src/a.ts', quiet)).toEqual([]);
  });

  it('covers product code at any depth and leaves out what never runs in a product process', () => {
    const covered = [
      'packages/agent-cli/src/modes/serve-http-host.ts',
      'packages/agent-cli/bin/agent.cjs',
      'apps/agent-app/electron/remote-runtime.ts',
      'packages/x/src/deep/er/module.mjs',
    ];
    const left = [
      'packages/x/src/__tests__/a.ts',
      'packages/x/src/deep/fixtures/a.ts',
      'packages/x/src/testing/double.ts',
      'packages/x/examples/a.ts',
      'packages/x/scripts/a.mjs',
      'apps/agent-app/e2e/a.mjs',
      'packages/x/src/a.test.ts',
      'packages/x/src/a.bintest.ts',
      'packages/x/src/a.d.ts',
      'packages/x/dist/a.js',
      'apps/remote-signaling/src/server.ts',
      'scripts/harness/a.mjs',
    ];
    expect(covered.filter((path) => !isProductSource(path))).toEqual([]);
    expect(left.filter((path) => isProductSource(path))).toEqual([]);
  });

  it('reads the row a gate opens under, and only a row named literally', () => {
    const code = [
      "startListener(SECURE_SURFACES['serve-http'], runtime, open);",
      'startListener(rule, runtime, open);',
    ].join('\n');
    expect(gateCalls('packages/x/src/a.ts', code)).toEqual([
      { line: 1, surface: 'serve-http' },
      { line: 2, surface: undefined },
    ]);
  });
});
