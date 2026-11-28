import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The security properties of the compose bundle, read from its files: nothing here starts Docker.
 * A change that weakens one of them fails here before it reaches a server.
 */
const BUNDLE = fileURLToPath(new URL('../../../../docker/personal-agent-host/', import.meta.url));
const SRC = fileURLToPath(new URL('../', import.meta.url));

const read = (name: string): string => readFileSync(`${BUNDLE}${name}`, 'utf8');

interface IService {
  image?: string;
  build?: unknown;
  profiles?: string[];
  network_mode?: string;
  read_only?: boolean;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  privileged?: boolean;
  ports?: unknown[];
  restart?: string;
  entrypoint?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  pid?: string;
  user?: string;
  command?: string[];
}

const compose = parse(read('compose.yaml')) as { services: Record<string, IService> };
const controlPlane = compose.services['control-plane'];
const proxy = compose.services.proxy;

/** A mount as [source, target], with each ${NAME:-default} replaced by its default. */
const mountOf = (volume: string): [string, string] => {
  const [source, target] = volume.replace(/\$\{[A-Z_]+:-([^}]*)\}/gu, '$1').split(':');
  return [source, target];
};

describe('the compose file', () => {
  it('has the control plane, the proxy and two build-only image services, and no unit or account', () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      'control-plane',
      'guard-image',
      'proxy',
      'unit-image',
    ]);
  });

  it('keeps the control plane off every network, read-only and without capabilities', () => {
    expect(controlPlane.network_mode).toBe('none');
    expect(controlPlane.ports ?? []).toEqual([]);
    expect(controlPlane.read_only).toBe(true);
    expect(controlPlane.cap_drop).toEqual(['ALL']);
    expect(controlPlane.cap_add).toBeUndefined();
    expect(controlPlane.privileged).toBeFalsy();
    expect(controlPlane.pid).toBeUndefined();
    expect(controlPlane.security_opt).toContain('no-new-privileges:true');
  });

  it('gives the control plane the engine socket and the state directory as its only mounts', () => {
    expect((controlPlane.volumes ?? []).map((v) => mountOf(v)[1]).sort()).toEqual([
      '/var/lib/personal-agent-host',
      '/var/run/docker.sock',
    ]);
  });

  it('runs the proxy on the host network with only the capability to bind ports', () => {
    expect(proxy.network_mode).toBe('host');
    expect(proxy.cap_drop).toEqual(['ALL']);
    expect(proxy.cap_add).toEqual(['NET_BIND_SERVICE']);
    expect(proxy.read_only).toBe(true);
    expect(proxy.privileged).toBeFalsy();
    expect(proxy.security_opt).toContain('no-new-privileges:true');
  });

  it('never gives the proxy the engine socket or the whole state directory', () => {
    const sources = (proxy.volumes ?? []).map((v) => mountOf(v)[0]);
    expect(sources).not.toContain('/var/run/docker.sock');
    expect(sources).not.toContain('/var/lib/personal-agent-host');
    expect(sources).toContain('/var/lib/personal-agent-host/proxy');
  });

  it('restarts the proxy from the configuration the control plane last loaded', () => {
    expect(proxy.command).toContain('--resume');
    expect(proxy.command?.[0]).toBe('caddy');
  });

  it('shares the proxy admin socket as a file in a directory, never as a TCP port', () => {
    const env = controlPlane.environment ?? {};
    expect(env.PERSONAL_AGENT_HOST_PROXY_ADMIN_SOCKET).toMatch(/^\/.+\.sock$/u);
    expect(env.PERSONAL_AGENT_HOST_PROXY_ADMIN_LISTEN).toMatch(/^\/.+\.sock$/u);
    expect(proxy.ports ?? []).toEqual([]);
    const bootstrap = read('proxy.Caddyfile');
    expect(bootstrap).toMatch(/^\s*admin unix\/\/\S+\|0600$/mu);
    expect(bootstrap).not.toMatch(/^\s*admin\s+(?!unix)/mu);
  });

  it('never runs a unit from compose and leaves the build-only services unable to start one', () => {
    for (const name of ['unit-image', 'guard-image']) {
      const service = compose.services[name];
      expect(service.profiles).toEqual(['build']);
      expect(service.entrypoint).toEqual(['/bin/false']);
      expect(service.network_mode).toBe('none');
      expect(service.restart).toBeUndefined();
      expect(service.ports ?? []).toEqual([]);
    }
    for (const service of Object.values(compose.services)) {
      expect(service.restart === undefined || service.restart === 'unless-stopped').toBe(true);
    }
    expect(
      Object.entries(compose.services)
        .filter(([, s]) => s.image === 'personal-agent:local')
        .map(([name]) => name),
    ).toEqual(['unit-image']);
  });

  it('pins every pulled image by digest and keeps the proxy image in step with its pin file', () => {
    expect(proxy.image).toMatch(/@sha256:[0-9a-f]{64}$/u);
    expect(proxy.image).toBe(read('caddy.image').trim());
    for (const file of ['control-plane/Dockerfile', 'guard/Dockerfile']) {
      const froms = read(file)
        .split('\n')
        .filter((line) => /^FROM\s/u.test(line));
      expect(froms.length).toBeGreaterThan(0);
      for (const line of froms) expect(line).toMatch(/@sha256:[0-9a-f]{64}/u);
    }
  });

  it('passes the control plane only settings it reads, and no credential', () => {
    const config = readFileSync(`${SRC}config.ts`, 'utf8');
    for (const name of Object.keys(controlPlane.environment ?? {})) {
      expect(name.startsWith('PERSONAL_AGENT_HOST_')).toBe(true);
      expect(name).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD/u);
      expect(config).toContain(`'${name.slice('PERSONAL_AGENT_HOST_'.length)}'`);
    }
  });
});

describe('the example settings', () => {
  const lines = read('example.env')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));

  it('lists names with placeholders only, never anything that looks like a secret', () => {
    for (const line of lines) {
      expect(line).toMatch(/^PERSONAL_AGENT_HOST_[A-Z_]+=\S*$/u);
      expect(line.split('=')[0]).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD/u);
      expect(line.split('=')[1]).not.toMatch(/^(sk-|ghp_|xox|AKIA)|[A-Za-z0-9+/]{32,}/u);
    }
  });

  it('names every setting the compose file takes from the environment', () => {
    const names = new Set(lines.map((line) => line.split('=')[0]));
    const used = [...read('compose.yaml').matchAll(/\$\{(PERSONAL_AGENT_HOST_[A-Z_]+)/gu)].map(
      (match) => match[1],
    );
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(names.has(name)).toBe(true);
  });
});

function sh(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [`${BUNDLE}install.sh`, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    timeout: 60_000,
  });
}

describe('the installer', () => {
  it('is valid shell and, where shellcheck is installed, clean under it', () => {
    expect(spawnSync('sh', ['-n', `${BUNDLE}install.sh`]).status).toBe(0);
    const probe = spawnSync('shellcheck', ['--version']);
    if (probe.status !== 0) return;
    const result = spawnSync('shellcheck', ['-s', 'sh', `${BUNDLE}install.sh`], {
      encoding: 'utf8',
    });
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('prints its usage for --help and refuses an unknown argument before changing anything', () => {
    const help = sh(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--dry-run');
    const bad = sh(['--install-everything']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('Usage');
  });

  it.skipIf(process.getuid?.() === 0)('refuses to run as a user other than root', () => {
    const result = sh([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('run this as root');
  });

  it('checks the prerequisites, prints its plan and creates nothing in a dry run', () => {
    const state = '/tmp/pah-installer-dry-run-must-not-exist';
    const result = sh(['--dry-run'], { PERSONAL_AGENT_HOST_STATE_PATH: state });
    expect(result.stdout).toContain('Checking the prerequisites');
    if (result.status === 0) {
      expect(result.stdout).toContain('Plan (nothing was changed)');
      expect(result.stdout).toContain(`create ${state}`);
    } else {
      // A machine without an engine or nf_tables names what is missing and stops.
      expect(result.stderr).toContain('missing:');
    }
    expect(existsSync(state)).toBe(false);
    // Above the spawn's own 60 s: a runner's engine can take seconds to answer.
  }, 70_000);

  it('refuses a state path that is not a plain absolute path', () => {
    for (const path of ['relative/dir', '/var/../etc', '/a b']) {
      const result = sh(['--dry-run'], { PERSONAL_AGENT_HOST_STATE_PATH: path });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('STATE_PATH');
    }
  });

  it('never asks for or stores a model key, and works under a restrictive umask', () => {
    const script = read('install.sh');
    expect(script).not.toMatch(/API_KEY|secrets\.env|Paste the|read -s|stty -echo/u);
    expect(script).toMatch(/^umask 077$/mu);
    expect(script).toContain("'run this as root");
  });
});
