import { describe, expect, it } from 'vitest';

import { loadConfig, publicOrigin } from '../config.js';
import { HostError } from '../errors.js';
import { main } from '../main.js';

const VALID = {
  PERSONAL_AGENT_HOST_BASE_DOMAIN: 'agents.example.test',
  PERSONAL_AGENT_HOST_TLS: 'ops@example.test',
  PERSONAL_AGENT_HOST_UNIT_IMAGE: 'personal-agent:1',
};

function refusal(env: Record<string, string>): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(HostError);
    return (error as HostError).message;
  }
  throw new Error('expected the configuration to be refused');
}

describe('configuration from the environment', () => {
  it('reads a valid environment with documented defaults', () => {
    const config = loadConfig(VALID);
    expect(config.tls).toEqual({ mode: 'acme', email: 'ops@example.test' });
    expect(config.allowContainer).toBe(false);
    expect(config.stateDir).toBe('/var/lib/personal-agent-host');
    expect(config.engineEndpoint).toBe('unix:///var/run/docker.sock');
    expect(config.subnetPool.slots).toBe(8192);
    expect(config.defaultLimits).toEqual({ memoryMb: 2048, cpus: 1, pids: 512 });
  });

  it('accepts internal TLS and an explicit allow flag', () => {
    const config = loadConfig({
      ...VALID,
      PERSONAL_AGENT_HOST_TLS: 'internal',
      PERSONAL_AGENT_HOST_ALLOW_CONTAINER: 'true',
    });
    expect(config.tls).toEqual({ mode: 'internal' });
    expect(config.allowContainer).toBe(true);
  });

  it('adds a port suffix to the public origin only for a non-default HTTPS port', () => {
    const plain = loadConfig(VALID);
    expect(publicOrigin(plain, 'a.agents.example.test')).toBe('https://a.agents.example.test');
    const custom = loadConfig({
      ...VALID,
      PERSONAL_AGENT_HOST_HTTPS_PORT: '8443',
      PERSONAL_AGENT_HOST_HTTP_PORT: '8080',
    });
    expect(publicOrigin(custom, 'a.agents.example.test')).toBe(
      'https://a.agents.example.test:8443',
    );
    const standard = loadConfig({ ...VALID, PERSONAL_AGENT_HOST_HTTPS_PORT: '443' });
    expect(publicOrigin(standard, 'a.agents.example.test')).toBe('https://a.agents.example.test');
  });

  it('names every missing required setting', () => {
    const message = refusal({});
    expect(message).toContain('PERSONAL_AGENT_HOST_BASE_DOMAIN');
    expect(message).toContain('PERSONAL_AGENT_HOST_TLS');
    expect(message).toContain('PERSONAL_AGENT_HOST_UNIT_IMAGE');
  });

  it.each([
    ['PERSONAL_AGENT_HOST_BASE_DOMAIN', 'Agents.Example.Test'],
    ['PERSONAL_AGENT_HOST_BASE_DOMAIN', 'bad_domain.test'],
    ['PERSONAL_AGENT_HOST_BASE_DOMAIN', '192.168.0.1'],
    ['PERSONAL_AGENT_HOST_TLS', 'not-an-email'],
    ['PERSONAL_AGENT_HOST_UNIT_IMAGE', 'bad image'],
    ['PERSONAL_AGENT_HOST_STATE_DIR', 'relative/dir'],
    ['PERSONAL_AGENT_HOST_SUBNET_POOL', '8.8.0.0/16'],
    ['PERSONAL_AGENT_HOST_SUBNET_POOL', '10.200.1.0/16'],
    ['PERSONAL_AGENT_HOST_SUBNET_POOL', '10.200.0.0/28'],
    ['PERSONAL_AGENT_HOST_SUBNET_POOL', 'ten'],
    ['PERSONAL_AGENT_HOST_ALLOW_CONTAINER', 'maybe'],
    ['PERSONAL_AGENT_HOST_HTTP_PORT', '0'],
    ['PERSONAL_AGENT_HOST_HTTPS_PORT', '70000'],
    ['PERSONAL_AGENT_HOST_MEMORY_MB', '8'],
    ['PERSONAL_AGENT_HOST_CPUS', 'many'],
    ['PERSONAL_AGENT_HOST_PIDS', '-1'],
    ['PERSONAL_AGENT_HOST_ENGINE_ENDPOINT', 'ftp://engine'],
    ['PERSONAL_AGENT_HOST_ENGINE_ENDPOINT', 'http://engine.example.test:2375'],
    ['PERSONAL_AGENT_HOST_ENGINE_ENDPOINT', 'unix://relative'],
  ])('refuses %s=%s and names the setting', (name, value) => {
    expect(refusal({ ...VALID, [name]: value })).toContain(name);
  });

  it('refuses equal HTTP and HTTPS ports', () => {
    const message = refusal({
      ...VALID,
      PERSONAL_AGENT_HOST_HTTP_PORT: '8080',
      PERSONAL_AGENT_HOST_HTTPS_PORT: '8080',
    });
    expect(message).toContain('HTTPS_PORT');
  });

  it('accepts a remote engine over https and a loopback engine over http', () => {
    expect(
      loadConfig({
        ...VALID,
        PERSONAL_AGENT_HOST_ENGINE_ENDPOINT: 'https://engine.example.test:2376',
      }).engineEndpoint,
    ).toContain('https://');
    expect(
      loadConfig({ ...VALID, PERSONAL_AGENT_HOST_ENGINE_ENDPOINT: 'http://127.0.0.1:2375' })
        .engineEndpoint,
    ).toContain('127.0.0.1');
  });
});

describe('check-config command', () => {
  it('prints a summary for a valid environment and no secret-bearing value', async () => {
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => (
      out.push(String(chunk)),
      true
    )) as typeof process.stdout.write;
    try {
      expect(await main(['check-config'], VALID)).toBe(0);
    } finally {
      process.stdout.write = write;
    }
    expect(out.join('')).toContain('agents.example.test');
  });

  it('exits non-zero with the problems for an invalid environment', async () => {
    const err: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => (
      err.push(String(chunk)),
      true
    )) as typeof process.stderr.write;
    try {
      expect(await main(['check-config'], {})).toBe(1);
      expect(await main(['nothing'], VALID)).toBe(2);
    } finally {
      process.stderr.write = write;
    }
    expect(err.join('')).toContain('PERSONAL_AGENT_HOST_BASE_DOMAIN');
  });
});
