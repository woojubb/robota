import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['hook-block-demo.mjs', ['"blocked": true', 'Bash tool blocked: dangerous command detected']],
  [
    'hook-json-response-demo.mjs',
    [
      'Security policy violation',
      '"permissionDecision": "deny"',
      'User has elevated permissions today.',
    ],
  ],
  ['hook-permission-mode-demo.mjs', ['hook stdout: "default"', 'hook stdout: "bypassPermissions"']],
  [
    'hook-timeout-demo.mjs',
    ['DEFAULT_TIMEOUT_SECONDS = 600', '"kind": "timeout"', 'hook completed'],
  ],
] as const;

describe('owner-local hook commands', () => {
  it.each(cases)(
    '%s preserves actual hook observations from the owner cwd',
    (name, observations) => {
      const output = execFileSync(process.execPath, [`examples/${name}`], {
        cwd: packageRoot,
        encoding: 'utf8',
        timeout: 15000,
      });
      for (const observation of observations) expect(output).toContain(observation);
      expect(output).toContain('PASS');
      expect(output).not.toContain('NO ✗');
    },
    20000,
  );

  it('resolves timeout runtime and inspected source independently of caller cwd', () => {
    const script = fileURLToPath(new URL('../../examples/hook-timeout-demo.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [script], {
      cwd: fileURLToPath(new URL('./', import.meta.url)),
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(output).toContain('DEFAULT_TIMEOUT_SECONDS = 600');
    expect(output).toContain('"kind": "timeout"');
    expect(output).toContain('PASS');
  }, 20000);
});
