import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, type TLSSocket } from 'node:tls';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { type AdminTransport, CaddyProxy } from '../proxy/caddy.js';
import { generateCaddyfile, type ICaddyfileSettings } from '../proxy/caddyfile.js';
import type { ProxySite } from '../proxy/port.js';
import { tempDir } from './harness.js';

/**
 * The generated configuration against the pinned proxy image. Opt in with
 * PERSONAL_AGENT_HOST_LIVE_PROXY=1. It runs `caddy validate` on the configuration, starts the proxy
 * with a Unix admin socket, loads configurations through it, and holds a WebSocket open across a
 * reload. It creates one container under a random name and removes it. Run it once; it is not part
 * of CI.
 */
const LIVE = process.env.PERSONAL_AGENT_HOST_LIVE_PROXY === '1';
const IMAGE = readFileSync(
  new URL('../../../../docker/personal-agent-host/caddy.image', import.meta.url),
  'utf8',
).trim();
const run = promisify(execFile);
const NAME = `pah-live-proxy-${randomBytes(3).toString('hex')}`;
const HTTPS_PORT = 18443;
const SETTINGS: ICaddyfileSettings = {
  tls: { mode: 'internal' },
  adminListen: '/run/caddy/admin.sock',
};

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', args, { timeout: 120_000 });
  return stdout;
}

/**
 * A stand-in unit in a container of its own, on the same user network as the proxy: port 7360
 * answers GET with its label, the Host it saw and the path; port 7361 does the same and also echoes
 * every byte of an upgraded connection.
 */
const UPSTREAM_SCRIPT = `
const http = require('node:http');
for (const [port, label] of [[7360, 'gui'], [7361, 'ws']]) {
  const server = http.createServer((req, res) => {
    res.end(label + ' host=' + req.headers.host + ' path=' + req.url);
  });
  server.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: echo\\r\\n\\r\\n');
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('error', () => undefined);
  });
  server.listen(port, '0.0.0.0');
}`;

function tlsConnect(servername: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: '127.0.0.1',
      port: HTTPS_PORT,
      servername,
      rejectUnauthorized: false,
    });
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function read(socket: TLSSocket, until: RegExp, ms = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(
      () => finish(new Error(`timed out waiting for ${until}: ${text}`)),
      ms,
    );
    const onData = (chunk: Buffer): void => {
      text += chunk.toString('utf8');
      if (until.test(text)) finish();
    };
    const onEnd = (): void => finish(new Error(`connection closed before ${until}: ${text}`));
    function finish(error?: Error): void {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('close', onEnd);
      if (error) reject(error);
      else resolve(text);
    }
    socket.on('data', onData);
    socket.on('close', onEnd);
  });
}

async function get(host: string, path: string): Promise<string> {
  const socket = await tlsConnect(host);
  socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  const text = await read(socket, /\r\n\r\n[\s\S]+/u).catch((e: Error) => e.message);
  socket.destroy();
  return text;
}

async function handshakeFails(servername: string): Promise<boolean> {
  try {
    (await tlsConnect(servername)).destroy();
    return false;
  } catch {
    return true;
  }
}

describe.skipIf(!LIVE)('the generated proxy configuration against the pinned image', () => {
  // The directory is bind-mounted into the proxy container, so on an engine inside a VM it must be
  // one the VM shares: PERSONAL_AGENT_HOST_LIVE_DIR names it (removed afterwards).
  const dir: Promise<string> = process.env.PERSONAL_AGENT_HOST_LIVE_DIR
    ? mkdtemp(join(process.env.PERSONAL_AGENT_HOST_LIVE_DIR, 'pah-proxy-'))
    : tempDir();
  const log: string[] = [];

  afterAll(async () => {
    await docker('rm', '-f', NAME).catch(() => undefined);
    await docker('volume', 'rm', `${NAME}-run`).catch(() => undefined);
    if (process.env.PERSONAL_AGENT_HOST_LIVE_DIR) {
      await rm(await dir, { recursive: true, force: true });
    }
    await docker('rm', '-f', `${NAME}-up`).catch(() => undefined);
    await docker('network', 'rm', `${NAME}-net`).catch(() => undefined);
    process.stdout.write(`proxy live results:\n${log.join('\n')}\n`);
  });

  it('validates every kind of site with the proxy’s own validator', async () => {
    const root = await dir;
    await mkdir(join(root, 'validate'), { recursive: true });
    const sites: ProxySite[] = [
      {
        kind: 'active',
        hostname: 'alice.agents.example.test',
        guiUpstream: '10.200.0.2:7360',
        wsUpstream: '10.200.0.2:7361',
      },
      { kind: 'suspended', hostname: 'bob.agents.example.test' },
      { kind: 'unavailable', hostname: 'carol.agents.example.test' },
    ];
    for (const [name, settings] of [
      ['internal', SETTINGS],
      ['acme', { ...SETTINGS, tls: { mode: 'acme', email: 'ops@example.test' } }],
      ['ports', { ...SETTINGS, httpPort: 8080, httpsPort: 8443 }],
      ['empty', SETTINGS],
    ] as const) {
      const file = join(root, 'validate', `${name}.Caddyfile`);
      await writeFile(file, generateCaddyfile(name === 'empty' ? [] : sites, settings));
      const { stdout, stderr } = await run('docker', [
        'run',
        '--rm',
        '-v',
        `${file}:/etc/caddy/Caddyfile:ro`,
        IMAGE,
        'caddy',
        'validate',
        '--config',
        '/etc/caddy/Caddyfile',
        '--adapter',
        'caddyfile',
      ]);
      expect(`${stdout}${stderr}`).toContain('Valid configuration');
      log.push(`validate ${name}: Valid configuration`);
    }
  }, 180_000);

  it('loads through the admin socket, answers known names, refuses unknown ones, and keeps a WebSocket across reloads', async () => {
    const root = await dir;
    await docker('network', 'create', `${NAME}-net`);
    await docker(
      'run',
      '-d',
      '--name',
      `${NAME}-up`,
      '--network',
      `${NAME}-net`,
      'node:22-alpine',
      'node',
      '-e',
      UPSTREAM_SCRIPT,
    );
    const unitAddress = (
      await docker(
        'inspect',
        '-f',
        `{{(index .NetworkSettings.Networks "${NAME}-net").IPAddress}}`,
        `${NAME}-up`,
      )
    ).trim();
    expect(unitAddress).toMatch(/^\d+\.\d+\.\d+\.\d+$/u);
    await mkdir(join(root, 'etc'), { recursive: true });
    const configPath = join(root, 'etc', 'Caddyfile');
    await writeFile(configPath, generateCaddyfile([], SETTINGS));

    await docker(
      'run',
      '-d',
      '--name',
      NAME,
      '--network',
      `${NAME}-net`,
      '-v',
      `${NAME}-run:/run/caddy`,
      '-v',
      `${join(root, 'etc')}:/etc/caddy`,
      '-p',
      `127.0.0.1:${HTTPS_PORT}:443`,
      IMAGE,
      'caddy',
      'run',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    );
    // The socket lives in a named volume, as it will in the compose file: an engine inside a VM
    // cannot chmod a socket on a shared directory. The proxy's own reload command is the client,
    // and a throwaway container sends one request shaped like the control plane's.
    let up = false;
    for (let i = 0; i < 40 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      up = await docker('exec', NAME, 'ls', '/run/caddy/admin.sock').then(
        () => true,
        () => false,
      );
    }
    expect(up).toBe(true);
    const probe = await docker(
      'run',
      '--rm',
      '-v',
      `${NAME}-run:/run/caddy`,
      'node:22-alpine',
      'node',
      '-e',
      `const {request}=require('node:http');
       const body=${JSON.stringify(generateCaddyfile([], SETTINGS))};
       const r=request({socketPath:'/run/caddy/admin.sock',method:'POST',path:'/load',
         headers:{'Content-Type':'text/caddyfile','Content-Length':Buffer.byteLength(body)}},
         (res)=>{res.resume();res.on('end',()=>console.log('status',res.statusCode))});
       r.on('error',(e)=>console.log('error',e.message));r.end(body);`,
    );
    log.push(`node http POST /load over the unix admin socket: ${probe.trim()}`);
    expect(probe).toContain('status 200');
    let corrupt = false;
    // A directory shared into a VM can lag behind the rename that replaced the file, so a load
    // that cannot see the file yet is tried again.
    const inner: AdminTransport = async () => {
      let last = '';
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const out = await docker(
            'exec',
            NAME,
            'caddy',
            'reload',
            '--config',
            '/etc/caddy/Caddyfile',
            '--adapter',
            'caddyfile',
            '--address',
            'unix//run/caddy/admin.sock',
          );
          return { status: 200, body: out };
        } catch (error) {
          last = (error as Error).message;
          if (!/no such file/u.test(last)) break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      return { status: 500, body: last };
    };
    // One load can be made to carry text the proxy cannot adapt, to see the rollback.
    const transport: AdminTransport = async (config) => {
      if (!corrupt) return inner(config);
      corrupt = false;
      await writeFile(configPath, 'not a caddyfile {{{');
      return inner('not a caddyfile {{{');
    };
    const proxy = new CaddyProxy({ configPath, settings: SETTINGS, transport });

    const alice = (extra: Partial<ProxySite> = {}): ProxySite =>
      ({
        kind: 'active',
        hostname: 'alice.agents.example.test',
        guiUpstream: `${unitAddress}:7360`,
        wsUpstream: `${unitAddress}:7361`,
        ...extra,
      }) as ProxySite;
    const bob: ProxySite = { kind: 'suspended', hostname: 'bob.agents.example.test' };
    const dave = (): ProxySite => ({
      ...alice(),
      hostname: 'dave.agents.example.test',
    });

    const applied = await proxy.apply([alice(), bob]);
    expect(applied.hash).toMatch(/^[0-9a-f]{16}$/u);
    log.push(`first load ok, hash ${applied.hash}`);

    // Issuance is per listed hostname: a listed name is served, an unlisted one fails the handshake.
    await new Promise((r) => setTimeout(r, 2_000));
    expect(await get('alice.agents.example.test', '/')).toContain(
      'gui host=alice.agents.example.test path=/',
    );
    expect(await get('alice.agents.example.test', '/ws/x')).toContain(
      'ws host=alice.agents.example.test path=/x',
    );
    expect(await get('bob.agents.example.test', '/')).toContain('503');
    expect(await handshakeFails('unknown.agents.example.test')).toBe(true);
    log.push(
      'known names answer (gui, ws path stripped, 503); unknown name fails the TLS handshake',
    );

    // A WebSocket opened now must survive a reload that adds another account.
    const socket = await tlsConnect('alice.agents.example.test');
    socket.write(
      'GET /ws/ HTTP/1.1\r\nHost: alice.agents.example.test\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n',
    );
    await read(socket, /101 Switching Protocols/u);
    socket.write('before');
    await read(socket, /before/u);
    const reloaded = await proxy.apply([alice(), bob, dave()]);
    expect(reloaded.hash).not.toBe(applied.hash);
    await new Promise((r) => setTimeout(r, 2_000));
    socket.write('after-reload');
    await read(socket, /after-reload/u);
    log.push('a WebSocket opened before a reload still echoes after it');
    socket.destroy();

    // A deleted account's name becomes unknown.
    await proxy.apply([alice(), dave()]);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(await handshakeFails('bob.agents.example.test')).toBe(true);
    expect(await get('dave.agents.example.test', '/')).toContain('gui host=');
    log.push('a deleted name fails the TLS handshake');

    // A configuration the proxy refuses is rolled back and the last good one keeps serving.
    const before = await readFile(configPath, 'utf8');
    corrupt = true;
    await expect(proxy.apply([alice(), dave(), bob])).rejects.toThrow(/previous one is kept/u);
    expect(await readFile(configPath, 'utf8')).toBe(before);
    expect(await get('alice.agents.example.test', '/')).toContain('gui host=');
    log.push('a refused configuration leaves the previous file and the proxy serving');
    // Negative control, recorded and not asserted: with no delay on stream close, what a reload does
    // to a live WebSocket on this proxy version.
    const control = new CaddyProxy({
      configPath,
      settings: { ...SETTINGS, streamCloseDelaySeconds: 0 },
      transport,
    });
    await control.apply([alice()]);
    await new Promise((r) => setTimeout(r, 1_500));
    const held = await tlsConnect('alice.agents.example.test');
    held.write(
      'GET /ws/ HTTP/1.1\r\nHost: alice.agents.example.test\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n',
    );
    await read(held, /101 Switching Protocols/u);
    await control.apply([alice(), dave()]);
    await new Promise((r) => setTimeout(r, 3_000));
    held.write('control');
    const survived = await read(held, /control/u, 3_000).then(
      () => true,
      () => false,
    );
    held.destroy();
    log.push(
      `control with stream_close_delay 0: WebSocket still echoes after a reload: ${survived}`,
    );
    const status = await docker('inspect', '-f', '{{.State.Status}}', NAME);
    expect(status.trim()).toBe('running');
  }, 240_000);
});
