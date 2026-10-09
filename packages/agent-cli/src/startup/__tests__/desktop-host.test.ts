import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { embeddedProductIdentity, resolveProductConfig } from '@robota-sdk/product-config';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createDesktopCliController,
  desktopContentSecurityPolicy,
  parseDesktopDaemonStart,
} from '../../desktop-host.js';
import { createTestProductEnvironment } from '../../__tests__/helpers/product-runtime.js';

const home = mkdtempSync(join(tmpdir(), 'desktop-consumer-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const config = resolveProductConfig({ environment: {
  ...createTestProductEnvironment('cedar'), HOME: home,
  PRODUCT_USER_STATE_DIR: join(home, 'cedar', 'state'),
  PRODUCT_CACHE_DIR: join(home, 'cedar', 'cache'),
  PRODUCT_LOG_DIR: join(home, 'cedar', 'logs'),
} });
const artifact = { identity: embeddedProductIdentity(config), version: '1.2.3' };

describe('public desktop CLI attachment', () => {
  it('refuses a token-bearing URL outside exact loopback and limits CSP to the attached port', () => {
    expect(parseDesktopDaemonStart('{"id":"x","url":"ws://evil.example:1234/?token=secret"}')).toBeUndefined();
    expect(parseDesktopDaemonStart('{"id":"x","url":"ws://127.0.0.1:1234/?token=secret"}')).toEqual({
      id: 'x', url: 'ws://127.0.0.1:1234/?token=secret', port: 1234,
    });
    expect(desktopContentSecurityPolicy(undefined)).toContain("connect-src 'none'");
  });

  it('asks before launch, restricts the first daemon, and refreshes endpoint on reconnect', async () => {
    const calls: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
    let port = 4101;
    const controller = createDesktopCliController({
      artifact,
      environment: { HOME: home, PATH: '/bin', OPENAI_API_KEY: 'unforwarded' },
      chooseTrust: async () => 'restricted',
      execute: async (args, env) => {
        calls.push({ args, env });
        if (args[0] === 'trust') return { exitCode: 0, stdout: '{"askable":true,"workspace":"/work","loads":["settings"]}', stderr: '' };
        return { exitCode: 0, stdout: JSON.stringify({ id: 'daemon', url: `ws://127.0.0.1:${port++}/?token=secret` }), stderr: '' };
      },
    });
    expect(controller.port()).toBeUndefined();
    expect((await controller.start()).ok).toBe(true);
    expect(controller.port()).toBe(4101);
    expect(controller.csp()).toContain('ws://127.0.0.1:4101');
    expect(calls[1]?.args).toContain('--restricted-workspace');
    expect(calls[1]?.env.OPENAI_API_KEY).toBeUndefined();
    await controller.reconnect();
    expect(controller.port()).toBe(4102);
    expect(calls.filter((call) => call.args[0] === 'trust')).toHaveLength(1);
  });

  it('forwards only references admitted by a fresh status after trust is granted', async () => {
    const calls: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
    let trusted = false;
    const controller = createDesktopCliController({
      artifact,
      environment: { HOME: home, OPENAI_API_KEY: 'provider-value', UNLISTED_SECRET: 'do-not-forward' },
      chooseTrust: async () => 'trust',
      execute: async (args, env) => {
        calls.push({ args, env });
        if (args[0] === 'trust' && args[1] === '--yes') {
          trusted = true;
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'trust') return { exitCode: 0, stdout: trusted
          ? '{"state":"trusted","askable":false,"providerEnvRefs":["OPENAI_API_KEY"]}'
          : '{"askable":true,"workspace":"/work","loads":[]}', stderr: '' };
        return { exitCode: 0, stdout: '{"id":"daemon","url":"ws://127.0.0.1:4103/?token=secret"}', stderr: '' };
      },
    });
    expect((await controller.start()).ok).toBe(true);
    const daemon = calls.at(-1)!;
    expect(daemon.env.OPENAI_API_KEY).toBe('provider-value');
    expect(daemon.env.UNLISTED_SECRET).toBeUndefined();
    expect(daemon.args).not.toContain('--restricted-workspace');
  });

  it('never starts a daemon for an invalid trust answer', async () => {
    const calls: string[] = [];
    const controller = createDesktopCliController({
      artifact,
      environment: { HOME: home },
      chooseTrust: async () => 'invalid' as never,
      execute: async (args) => {
        calls.push(args[0]!);
        return { exitCode: 0, stdout: '{"askable":true,"workspace":"/work","loads":[]}', stderr: '' };
      },
    });
    expect(await controller.start()).toEqual({ ok: false, detail: 'Desktop trust answer was invalid.' });
    expect(calls).toEqual(['trust']);
  });

  it('does not admit references after a grant unless renewal is freshly trusted', async () => {
    const calls: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
    const revoked = '{"state":"revoked","askable":true,"workspace":"/work","loads":[],"providerEnvRefs":["SYNTHETIC_SECRET"]}';
    const controller = createDesktopCliController({
      artifact,
      environment: { HOME: home, SYNTHETIC_SECRET: 'unforwarded' },
      chooseTrust: async () => 'trust',
      execute: async (args, env) => {
        calls.push({ args, env });
        if (args[1] === '--yes') return { exitCode: 0, stdout: '', stderr: '' };
        if (args[0] === 'trust') return { exitCode: 0, stdout: revoked, stderr: '' };
        return { exitCode: 0, stdout: '{"id":"daemon","url":"ws://127.0.0.1:4104/?token=secret"}', stderr: '' };
      },
    });
    expect(await controller.start()).toEqual({ ok: false, detail: 'Workspace trust could not be confirmed after grant.' });
    expect(calls.every((call) => call.args[0] === 'trust')).toBe(true);
    expect(calls.every((call) => call.env.SYNTHETIC_SECRET === undefined)).toBe(true);
  });

  it.each([
    { exitCode: 1, stdout: '' },
    { exitCode: 0, stdout: 'not-json' },
    { exitCode: 0, stdout: '{"state":"trusted","askable":true,"providerEnvRefs":["SYNTHETIC_SECRET"]}' },
  ])('stops visibly after a failed or contradictory trust renewal: %j', async (renewed) => {
    const calls: string[][] = [];
    let statusCount = 0;
    const controller = createDesktopCliController({
      artifact,
      environment: { HOME: home, SYNTHETIC_SECRET: 'unforwarded' },
      chooseTrust: async () => 'trust',
      execute: async (args) => {
        calls.push([...args]);
        if (args[1] === '--yes') return { exitCode: 0, stdout: '', stderr: '' };
        if (args[0] === 'trust') {
          statusCount += 1;
          return statusCount === 1
            ? { exitCode: 0, stdout: '{"state":"untrusted","askable":true,"workspace":"/work","loads":[]}', stderr: '' }
            : { ...renewed, stderr: '' };
        }
        return { exitCode: 0, stdout: '{"id":"daemon","url":"ws://127.0.0.1:4105/?token=secret"}', stderr: '' };
      },
    });
    expect(await controller.start()).toEqual({ ok: false, detail: 'Workspace trust could not be confirmed after grant.' });
    expect(calls.every((args) => args[0] === 'trust')).toBe(true);
  });
});
