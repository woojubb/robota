import { describe, expect, it } from 'vitest';
import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { createTrustedWorkspaceProjectAccess } from '../../__tests__/helpers/trusted-workspace-project-access.js';
import { parseCliArgs } from '../../utils/cli-args.js';
import { acpProtocolArgs, admitAcpWorkspace, validateAcpInvocation } from '../acp-invocation.js';

describe('acpProtocolArgs', () => {
  it('recognizes an acp run, which speaks ACP on stdout', () => {
    expect(acpProtocolArgs(['acp'])?.positional).toEqual(['acp']);
    expect(acpProtocolArgs(['--safe-mode', 'acp'])?.positional).toEqual(['acp']);
  });

  it('is undefined for a help request, whose text must reach stdout', () => {
    expect(acpProtocolArgs(['acp', '--help'])).toBeUndefined();
    expect(acpProtocolArgs(['acp', '-h'])).toBeUndefined();
  });

  it('is undefined for anything that is not the acp subcommand', () => {
    expect(acpProtocolArgs(['mcp', 'serve'])).toBeUndefined();
    expect(acpProtocolArgs(['--', 'acp'])).toBeUndefined();
    expect(acpProtocolArgs([])).toBeUndefined();
  });
});

describe('validateAcpInvocation', () => {
  const validate = (...argv: string[]) => validateAcpInvocation(parseCliArgs(argv), 'test-product');

  it('accepts a bare acp and allows the ordinary session flags', () => {
    expect(validate('acp')).toEqual({ acp: true });
    expect(validate('acp', '--permission-mode', 'plan', '--model', 'x')).toEqual({ acp: true });
  });

  it('is not an acp run for other invocations', () => {
    expect(validate()).toEqual({ acp: false });
    expect(validate('mcp', 'serve')).toEqual({ acp: false });
    expect(validate('-p', 'hello')).toEqual({ acp: false });
    expect(validate('--serve')).toEqual({ acp: false });
  });

  it('refuses arguments after acp, naming the usage', () => {
    expect(() => validate('acp', 'extra')).toThrow('Usage: test-product acp');
    expect(() => validate('acp', '-p', 'task')).toThrow('Usage: test-product acp');
  });

  it.each([['--serve'], ['-p'], ['--goal', 'task'], ['--open'], ['--configure'], ['--reset']])(
    'refuses acp combined with %s',
    (...flags: string[]) => {
      expect(() => validate('acp', ...flags)).toThrow('cannot be combined');
    },
  );
});

describe('admitAcpWorkspace', () => {
  const base = { cwd: '/workspace', cliName: 'test-product', restrictedByChoice: false };

  it('admits a trusted workspace', async () => {
    const access = await createTrustedWorkspaceProjectAccess(process.cwd());
    expect(admitAcpWorkspace({ ...base, access })).toEqual({ admitted: true });
  });

  it('refuses an untrusted workspace with the headless trust guidance', () => {
    const access = createRestrictedWorkspaceProjectAccess('untrusted', '/workspace');
    const verdict = admitAcpWorkspace({ ...base, access });
    expect(verdict.admitted).toBe(false);
    if (verdict.admitted) return;
    expect(verdict.message).toContain('test-product trust --yes');
    expect(verdict.message).toContain('Workspace: /workspace');
  });

  it.each(['revoked', 'stale/replaced', 'store-unavailable'] as const)(
    'refuses a workspace whose trust is %s',
    (state) => {
      const access = createRestrictedWorkspaceProjectAccess(state, '/workspace');
      expect(admitAcpWorkspace({ ...base, access }).admitted).toBe(false);
    },
  );

  it('admits a workspace a person chose to run Restricted, as the headless gate does', () => {
    const access = createRestrictedWorkspaceProjectAccess('untrusted', '/workspace');
    expect(admitAcpWorkspace({ ...base, access, restrictedByChoice: true })).toEqual({
      admitted: true,
    });
  });
});
