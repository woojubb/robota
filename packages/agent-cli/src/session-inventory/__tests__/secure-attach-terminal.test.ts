/**
 * `the product --attach` on a real secure daemon, rendered by the real attached terminal: the
 * renderer the in-process attach tests replace, on a certified runtime that holds no key until the
 * owner's link hands it one. The terminal is the owner's client of the daemon's conversation, so it
 * must come up without building a conversation store, a prompt history file or a key holder of its
 * own — a secure process given none refuses to build one — and leave without stopping the daemon.
 *
 * Ink needs a terminal to read keys from; the test process has none, so standard input claims to be
 * one and raw mode is a no-op. Nothing is typed: the daemon ends the app.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';
import { stopSupervisedSession, workspaceRootBrokerEndpoint } from '@robota-sdk/agent-local-host';
import {
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
  renderAttachedApp,
} from '@robota-sdk/agent-ui-terminal';
import { afterEach, expect, it, vi } from 'vitest';

import { startTestBroker } from '../../__tests__/helpers/test-workspace-root-broker.js';
import {
  createTestBinaryEnvironment,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { createAttachedAppRender } from '../../startup/attached-app-render.js';
import { createThemeSurface } from '../../startup/theme-surface.js';
import { launchCertifiedRuntime } from '../certified-runtime-launch.js';
import { runDaemonAttachCommand } from '../daemon-attach-command.js';
import {
  listSupervisedSessions,
  resolveSupervisedDirectory,
} from '../supervised-session-control.js';

import type { TAttachedAppRender } from '../session-attach-command.js';

let restoreStdin: () => void = () => undefined;

afterEach(() => {
  restoreStdin();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function claimTerminalInput(): void {
  const stdin = process.stdin as NodeJS.ReadStream;
  const tty = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
  const rawMode = Object.getOwnPropertyDescriptor(stdin, 'setRawMode');
  Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(stdin, 'setRawMode', {
    value: () => stdin,
    configurable: true,
    writable: true,
  });
  restoreStdin = () => {
    if (tty === undefined) delete (stdin as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(stdin, 'isTTY', tty);
    if (rawMode === undefined) delete (stdin as { setRawMode?: unknown }).setRawMode;
    else Object.defineProperty(stdin, 'setRawMode', rawMode);
  };
}

/** Swallow terminal output, but complete each write: Ink waits for its last frame to flush. */
function captureWrites(stream: NodeJS.WriteStream): { readonly text: () => string } {
  const spy = vi.spyOn(stream, 'write').mockImplementation(((
    _chunk: unknown,
    encodingOrDone?: unknown,
    done?: unknown,
  ) => {
    const callback = typeof encodingOrDone === 'function' ? encodingOrDone : done;
    if (typeof callback === 'function') queueMicrotask(() => callback());
    return true;
  }) as typeof stream.write);
  return { text: () => spy.mock.calls.map(([chunk]) => String(chunk)).join('') };
}

it.skipIf(process.platform === 'win32')(
  'attaches the real terminal to a real secure daemon without a store of its own, and ends with the daemon',
  async () => {
    const home = realpathSync(mkdtempSync(join(realpathSync('/tmp'), 'sat-')));
    vi.stubEnv('HOME', home);
    claimTerminalInput();
    const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
    const runtime = createTestProductRuntime('test-product', env);
    const brokerEndpoint = workspaceRootBrokerEndpoint(runtime.layout.userRoot);
    mkdirSync(dirname(brokerEndpoint), { recursive: true, mode: 0o700 });
    const broker = await startTestBroker(
      brokerEndpoint,
      dirname(brokerEndpoint),
      runtime.layout.userPaths.workspaceTrust,
    );
    const root = resolveSupervisedDirectory(runtime);
    const { keyring } = await fixtureKeyring();
    mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
    writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
    const launchOwner = await openOwnerHandover(keyring, {
      type: 'passphrase',
      passphrase: FIXTURE_PASSPHRASE,
    });
    let daemon: Awaited<ReturnType<typeof launchCertifiedRuntime>> | undefined;
    try {
      daemon = await launchCertifiedRuntime(home, {
        productRuntime: runtime,
        env,
        root,
        restricted: true,
        daemonRole: true,
        handover: launchOwner,
        entrypoint: fileURLToPath(
          new URL('../../testing/secure-runtime-entry.ts', import.meta.url),
        ),
        execArgs: [
          '--import',
          pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
          '--conditions=product-source',
        ],
      });
      overrideProductSecureMode(runtime, true);
      const stdout = captureWrites(process.stdout);
      const stderr = captureWrites(process.stderr);
      const rendered = vi.fn<typeof renderAttachedApp>(async (options) =>
        renderAttachedApp(options),
      );
      const renderTerminal = createAttachedAppRender(
        {
          renderAttachedApp: rendered,
          createThemeSurface,
          createNodeKeybindingsSource,
          createDefaultTuiCliAdapter,
          installTuiProcessGuards: vi.fn(),
        },
        {
          productRuntime: runtime,
          cwd: home,
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
          providerDefinitions: [],
        },
      );
      const sent: string[] = [];
      const render: TAttachedAppRender = (options) =>
        renderTerminal({
          ...options,
          connection: {
            ...options.connection,
            send: (message) => {
              sent.push(message.type);
              options.connection.send(message);
            },
          },
        });
      const owner = await openOwnerHandover(keyring, {
        type: 'passphrase',
        passphrase: FIXTURE_PASSPHRASE,
      });
      const attached = runDaemonAttachCommand(['--attach'], {
        productRuntime: runtime,
        cwd: home,
        root,
        isTTY: true,
        list: listSupervisedSessions,
        openSecureOwner: async () => owner,
        render,
      });
      // An attach that ends before the terminal is up reports why, rather than waiting it out.
      const endedEarly = attached.then((code) => {
        throw new Error(
          `The attach ended with ${code} before the terminal was up: ${stderr.text()}`,
        );
      });
      endedEarly.catch(() => undefined);
      // The app is up once it asks the daemon for the conversation it attached to.
      await Promise.race([
        vi.waitFor(() => expect(sent).toContain('get-history'), { timeout: 20_000 }),
        endedEarly,
      ]);
      const options = rendered.mock.calls[0]?.[0];
      expect(options?.promptHistorySource).toBeUndefined();
      expect(existsSync(runtime.layout.userPaths.history)).toBe(false);
      await stopSupervisedSession(daemon.id, root, daemon.generation);
      expect(await attached).toBe(0);
      expect(owner.disposed).toBe(true);
      expect(stderr.text()).toBe('');
      expect(stdout.text()).toContain(
        'The daemon closed the connection (it stopped, or cut this terminal off).\n',
      );
    } finally {
      launchOwner.dispose();
      if (daemon) {
        try {
          await stopSupervisedSession(daemon.id, root, daemon.generation);
        } catch {
          // Already stopped by the test body.
        }
      }
      await broker.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
  90_000,
);
