/**
 * TC-02 — environment templates.
 *
 * The case that matters most is the last one: an unset reference with no default must leave its
 * literal text in place and be reported. Substituting an empty string would produce a URL or a
 * header that looks configured and authenticates as nobody.
 */

import { describe, expect, it } from 'vitest';

import { materializeDefinition } from '../definition/env-template.js';

import type { IMCPServerDefinition } from '../definition/types.js';

const stdio = (overrides: Partial<IMCPServerDefinition> = {}): IMCPServerDefinition => ({
  name: 'alpha',
  source: 'project',
  origin: '.mcp.json',
  transport: 'stdio',
  command: 'server',
  ...overrides,
});

describe('materializeDefinition', () => {
  it('expands ${VAR} in command, args and env', () => {
    const resolved = materializeDefinition(
      stdio({
        command: '${BIN}/server',
        args: ['--port', '${PORT}'],
        env: { TOKEN: 'tok-${SUFFIX}' },
        cwd: '${ROOT}/work',
      }),
      { BIN: '/usr/local/bin', PORT: '8080', SUFFIX: 'abc', ROOT: '/project' },
    );

    expect(resolved.command).toBe('/usr/local/bin/server');
    expect(resolved.args).toEqual(['--port', '8080']);
    expect(resolved.env).toEqual({ TOKEN: 'tok-abc' });
    expect(resolved.cwd).toBe('/project/work');
    expect(resolved.unsetVariables).toEqual([]);
  });

  it('expands ${VAR} in url and headers', () => {
    const resolved = materializeDefinition(
      {
        name: 'beta',
        source: 'user',
        origin: 'user.json',
        transport: 'http',
        url: 'https://${HOST}/mcp',
        headers: { Authorization: 'Bearer ${API_TOKEN}' },
      },
      { HOST: 'api.example', API_TOKEN: 'secret' },
    );

    expect(resolved.url).toBe('https://api.example/mcp');
    expect(resolved.headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it('uses ${VAR:-default} when the variable is unset, and the value when it is set', () => {
    const unsetCase = materializeDefinition(stdio({ command: '${BIN:-/bin/server}' }), {});
    expect(unsetCase.command).toBe('/bin/server');
    expect(unsetCase.unsetVariables).toEqual([]);

    const setCase = materializeDefinition(stdio({ command: '${BIN:-/bin/server}' }), {
      BIN: '/opt/server',
    });
    expect(setCase.command).toBe('/opt/server');
  });

  it('treats an empty default as a declared value, not as missing', () => {
    const resolved = materializeDefinition(stdio({ args: ['${FLAG:-}'] }), {});
    expect(resolved.args).toEqual(['']);
    expect(resolved.unsetVariables).toEqual([]);
  });

  it('warns and preserves the literal reference when a variable is unset with no default', () => {
    const resolved = materializeDefinition(
      {
        name: 'gamma',
        source: 'plugin',
        origin: 'plugin-a',
        transport: 'http',
        url: 'https://api.example/${MISSING_PATH}',
        headers: { Authorization: 'Bearer ${MISSING_TOKEN}' },
      },
      {},
    );

    expect(resolved.url).toBe('https://api.example/${MISSING_PATH}');
    expect(resolved.headers).toEqual({ Authorization: 'Bearer ${MISSING_TOKEN}' });
    expect(resolved.unsetVariables).toEqual([
      { variable: 'MISSING_PATH', field: 'url', literal: '${MISSING_PATH}' },
      { variable: 'MISSING_TOKEN', field: 'headers.Authorization', literal: '${MISSING_TOKEN}' },
    ]);
  });

  it('names the exact field of an unset reference, including the array index', () => {
    const resolved = materializeDefinition(stdio({ args: ['--a', '${NOPE}'] }), {});
    expect(resolved.unsetVariables.map((unset) => unset.field)).toEqual(['args[1]']);
  });

  it('leaves text that is not a reference alone', () => {
    const resolved = materializeDefinition(stdio({ command: 'echo $HOME ${} $ {X}' }), {
      HOME: '/root',
    });
    expect(resolved.command).toBe('echo $HOME ${} $ {X}');
    expect(resolved.unsetVariables).toEqual([]);
  });
});
